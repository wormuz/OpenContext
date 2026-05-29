//! Index synchronization service
//!
//! Listens to document events and batches index updates.
//! Uses interval-based checking (default: 5 minutes) instead of real-time updates.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use rusqlite;

use tokio::sync::{broadcast, watch, Mutex, Notify};
use tokio::time::{interval_at, Instant};

use super::config::SearchConfig;
use super::error::SearchResult;
use super::indexer::Indexer;
use crate::events::{DocEvent, Event, FolderEvent, SharedEventBus};

/// Update action for the index
#[derive(Debug, Clone)]
enum IndexAction {
    /// Index or re-index a file
    Update { rel_path: String },
    /// Remove a file from the index
    Remove { rel_path: String },
    /// Rename/move a file in the index
    Rename { old_path: String, new_path: String },
}

/// Index synchronization service
///
/// Collects file change events and processes them in batches at regular intervals.
pub struct IndexSyncService {
    config: SearchConfig,
    contexts_root: PathBuf,
    /// SQLite db path for WAL replay on startup
    db_path: Option<PathBuf>,
    indexer: Arc<Mutex<Option<Indexer>>>,
    enabled: Arc<std::sync::atomic::AtomicBool>,
    /// Pending actions waiting to be processed
    pending_actions: Arc<Mutex<HashMap<String, IndexAction>>>,
    /// Interval in seconds for checking pending updates (default: 300 = 5 minutes)
    check_interval_secs: u64,
    /// Shutdown sender — drop or send to stop the service
    shutdown_tx: watch::Sender<bool>,
    /// Shutdown receiver — passed into spawned tasks
    shutdown_rx: watch::Receiver<bool>,
    /// External flush signal — notified to wake up interval loop immediately
    flush_notify: Option<Arc<Notify>>,
}

impl IndexSyncService {
    /// Create a new index sync service
    /// Default check interval is 5 minutes (300 seconds)
    pub fn new(config: SearchConfig, contexts_root: PathBuf) -> Self {
        let (shutdown_tx, shutdown_rx) = watch::channel(false);
        Self {
            config,
            contexts_root,
            db_path: None,
            indexer: Arc::new(Mutex::new(None)),
            enabled: Arc::new(std::sync::atomic::AtomicBool::new(true)),
            pending_actions: Arc::new(Mutex::new(HashMap::new())),
            check_interval_secs: 300,
            shutdown_tx,
            shutdown_rx,
            flush_notify: None,
        }
    }

    /// Signal the service to stop and flush pending actions.
    pub fn stop(&self) {
        let _ = self.shutdown_tx.send(true);
    }

    /// Set check interval in seconds
    pub fn with_interval(mut self, secs: u64) -> Self {
        self.check_interval_secs = secs;
        self
    }

    /// Set db path for WAL replay on startup
    pub fn with_db_path(mut self, db_path: PathBuf) -> Self {
        self.db_path = Some(db_path);
        self
    }

    /// Set external flush notify — when notified, interval loop runs immediately
    pub fn with_flush_notify(mut self, notify: Arc<Notify>) -> Self {
        self.flush_notify = Some(notify);
        self
    }

    /// Enable or disable the service
    pub fn set_enabled(&self, enabled: bool) {
        self.enabled
            .store(enabled, std::sync::atomic::Ordering::SeqCst);
    }

    /// Check if the service is enabled
    pub fn is_enabled(&self) -> bool {
        self.enabled.load(std::sync::atomic::Ordering::SeqCst)
    }

    /// Get count of pending updates
    pub async fn pending_count(&self) -> usize {
        self.pending_actions.lock().await.len()
    }

    /// Start the sync service, listening to events from the event bus
    ///
    /// Events are collected and processed in batches at regular intervals (default: 5 minutes)
    pub async fn start(&self, event_bus: SharedEventBus) -> SearchResult<()> {
        let mut receiver = event_bus.subscribe();

        // Initialize indexer
        {
            let mut indexer_guard = self.indexer.lock().await;
            if indexer_guard.is_none() {
                let indexer = Indexer::new(self.config.clone(), self.contexts_root.clone()).await?;
                *indexer_guard = Some(indexer);
            }
        }

        // Replay any pending WAL entries from previous run
        if let Some(ref db_path) = self.db_path {
            self.replay_wal(db_path.clone()).await;
        }

        // Spawn interval processor (every N seconds)
        let indexer = self.indexer.clone();
        let enabled = self.enabled.clone();
        let pending = self.pending_actions.clone();
        let interval_secs = self.check_interval_secs;
        let mut shutdown_for_interval = self.shutdown_rx.clone();
        let db_path_for_interval = self.db_path.clone();
        let flush_notify_for_interval = self.flush_notify.clone();

        tokio::spawn(async move {
            Self::process_pending_interval(
                pending,
                indexer,
                enabled,
                interval_secs,
                &mut shutdown_for_interval,
                db_path_for_interval,
                flush_notify_for_interval,
            )
            .await;
        });

        log::info!(
            "[IndexSync] Started with {} second interval",
            self.check_interval_secs
        );

        let mut shutdown_rx = self.shutdown_rx.clone();

        // Event listener loop - just collect actions, don't process immediately
        loop {
            tokio::select! {
                event_result = receiver.recv() => {
                    match event_result {
                        Ok(event) => {
                            if !self.is_enabled() {
                                continue;
                            }

                            let actions = Self::event_to_actions(event);
                            let mut pending_guard = self.pending_actions.lock().await;
                            for action in actions {
                                match &action {
                                    IndexAction::Update { rel_path } => {
                                        pending_guard.insert(rel_path.clone(), action);
                                    }
                                    IndexAction::Remove { rel_path } => {
                                        pending_guard.insert(rel_path.clone(), action);
                                    }
                                    IndexAction::Rename { old_path, new_path } => {
                                        pending_guard.remove(old_path);
                                        pending_guard.insert(new_path.clone(), action);
                                    }
                                }
                            }

                            let count = pending_guard.len();
                            if count > 0 {
                                log::debug!("[IndexSync] {} pending updates", count);
                            }
                        }
                        Err(broadcast::error::RecvError::Lagged(n)) => {
                            log::warn!("[IndexSync] Lagged behind by {} events", n);
                        }
                        Err(broadcast::error::RecvError::Closed) => {
                            log::info!("[IndexSync] Event bus closed, stopping sync service");
                            break;
                        }
                    }
                }
                _ = shutdown_rx.changed() => {
                    if *shutdown_rx.borrow() {
                        log::info!("[IndexSync] Shutdown signal received, flushing pending actions");
                        Self::flush_pending(self.pending_actions.clone(), self.indexer.clone()).await;
                        break;
                    }
                }
            }
        }

        Ok(())
    }

    /// Convert an event to index actions
    fn event_to_actions(event: Event) -> Vec<IndexAction> {
        match event {
            Event::Doc(doc_event) => match doc_event {
                DocEvent::Created { rel_path } | DocEvent::Updated { rel_path } => {
                    vec![IndexAction::Update { rel_path }]
                }
                DocEvent::Deleted { rel_path } => {
                    vec![IndexAction::Remove { rel_path }]
                }
                DocEvent::Renamed { old_path, new_path }
                | DocEvent::Moved { old_path, new_path } => {
                    vec![IndexAction::Rename { old_path, new_path }]
                }
            },
            Event::Folder(folder_event) => match folder_event {
                FolderEvent::Created { .. } => vec![],
                FolderEvent::Renamed { affected_docs, .. }
                | FolderEvent::Moved { affected_docs, .. } => affected_docs
                    .into_iter()
                    .map(|(old_path, new_path)| IndexAction::Rename { old_path, new_path })
                    .collect(),
                FolderEvent::Deleted { removed_docs, .. } => removed_docs
                    .into_iter()
                    .map(|rel_path| IndexAction::Remove { rel_path })
                    .collect(),
            },
        }
    }

    /// Flush all pending actions immediately (called on shutdown).
    async fn flush_pending(
        pending: Arc<Mutex<HashMap<String, IndexAction>>>,
        indexer: Arc<Mutex<Option<Indexer>>>,
    ) {
        let actions: Vec<IndexAction> = {
            let mut guard = pending.lock().await;
            guard.drain().map(|(_, v)| v).collect()
        };
        if actions.is_empty() {
            return;
        }
        log::info!(
            "[IndexSync] Flushing {} pending actions on shutdown",
            actions.len()
        );
        let mut guard = indexer.lock().await;
        if let Some(ref mut idx) = *guard {
            if idx.index_exists().await {
                Self::apply_actions(idx, actions).await;
            }
        }
    }

    /// Process pending actions at regular intervals
    async fn process_pending_interval(
        pending: Arc<Mutex<HashMap<String, IndexAction>>>,
        indexer: Arc<Mutex<Option<Indexer>>>,
        enabled: Arc<std::sync::atomic::AtomicBool>,
        interval_secs: u64,
        shutdown_rx: &mut watch::Receiver<bool>,
        db_path: Option<PathBuf>,
        flush_notify: Option<Arc<Notify>>,
    ) {
        // Start first tick after interval_secs (not immediately)
        let start = Instant::now() + Duration::from_secs(interval_secs);
        let mut ticker = interval_at(start, Duration::from_secs(interval_secs));

        loop {
            if let Some(ref notify) = flush_notify {
                tokio::select! {
                    _ = ticker.tick() => {}
                    _ = notify.notified() => {
                        log::info!("[IndexSync] Flush signal received");
                    }
                    _ = shutdown_rx.changed() => {
                        if *shutdown_rx.borrow() { return; }
                    }
                }
            } else {
                tokio::select! {
                    _ = ticker.tick() => {}
                    _ = shutdown_rx.changed() => {
                        if *shutdown_rx.borrow() { return; }
                    }
                }
            }

            if !enabled.load(std::sync::atomic::Ordering::SeqCst) {
                continue;
            }

            // Poll WAL for entries written by other processes (CLI, Web UI)
            if let Some(ref path) = db_path {
                if let Ok(conn) = rusqlite::Connection::open(path) {
                    match crate::wal::load_pending(&conn) {
                        Ok(wal_entries) if !wal_entries.is_empty() => {
                            log::debug!(
                                "[IndexSync] WAL poll: {} cross-process entries",
                                wal_entries.len()
                            );
                            let mut pending_guard = pending.lock().await;
                            for (id, op) in &wal_entries {
                                let action = match op {
                                    crate::wal::WalOp::Update { rel_path } => IndexAction::Update {
                                        rel_path: rel_path.clone(),
                                    },
                                    crate::wal::WalOp::Remove { rel_path } => IndexAction::Remove {
                                        rel_path: rel_path.clone(),
                                    },
                                    crate::wal::WalOp::Rename { old_path, new_path } => {
                                        IndexAction::Rename {
                                            old_path: old_path.clone(),
                                            new_path: new_path.clone(),
                                        }
                                    }
                                };
                                match &action {
                                    IndexAction::Update { rel_path }
                                    | IndexAction::Remove { rel_path } => {
                                        pending_guard.insert(rel_path.clone(), action);
                                    }
                                    IndexAction::Rename { old_path, new_path } => {
                                        pending_guard.remove(old_path);
                                        pending_guard.insert(new_path.clone(), action);
                                    }
                                }
                                let _ = crate::wal::mark_done(&conn, *id);
                            }
                        }
                        Err(e) => log::warn!("[IndexSync] WAL poll error: {}", e),
                        _ => {}
                    }
                }
            }

            // Take all pending actions
            let actions: Vec<IndexAction> = {
                let mut pending_guard = pending.lock().await;
                if pending_guard.is_empty() {
                    continue;
                }
                pending_guard.drain().map(|(_, v)| v).collect()
            };

            log::info!("[IndexSync] Processing {} pending updates", actions.len());

            let mut indexer_guard = indexer.lock().await;
            if let Some(ref mut idx) = *indexer_guard {
                if !idx.index_exists().await {
                    log::debug!("[IndexSync] Index not built, skipping updates");
                    continue;
                }
                Self::apply_actions(idx, actions).await;
            }
            drop(indexer_guard);

            // Prune WAL done-entries older than 7 days
            if let Some(ref path) = db_path {
                if let Ok(conn) = rusqlite::Connection::open(path) {
                    match crate::wal::prune_done(&conn, 7) {
                        Ok(n) if n > 0 => log::debug!("[IndexSync] WAL pruned {} done entries", n),
                        Err(e) => log::warn!("[IndexSync] WAL prune error: {}", e),
                        _ => {}
                    }
                }
            }
        }
    }

    /// Replay pending WAL entries from a previous (crashed) run.
    async fn replay_wal(&self, db_path: PathBuf) {
        let pending_entries = match rusqlite::Connection::open(&db_path) {
            Ok(conn) => match crate::wal::load_pending(&conn) {
                Ok(entries) => entries,
                Err(e) => {
                    log::warn!("[IndexSync] WAL load failed: {}", e);
                    return;
                }
            },
            Err(e) => {
                log::warn!("[IndexSync] WAL db open failed: {}", e);
                return;
            }
        };

        if pending_entries.is_empty() {
            return;
        }

        log::info!(
            "[IndexSync] Replaying {} pending WAL entries",
            pending_entries.len()
        );

        let actions: Vec<IndexAction> = pending_entries
            .iter()
            .map(|(_, op)| match op {
                crate::wal::WalOp::Update { rel_path } => IndexAction::Update {
                    rel_path: rel_path.clone(),
                },
                crate::wal::WalOp::Remove { rel_path } => IndexAction::Remove {
                    rel_path: rel_path.clone(),
                },
                crate::wal::WalOp::Rename { old_path, new_path } => IndexAction::Rename {
                    old_path: old_path.clone(),
                    new_path: new_path.clone(),
                },
            })
            .collect();

        // Queue into pending — processed on next interval tick
        let mut guard = self.pending_actions.lock().await;
        for action in actions {
            match &action {
                IndexAction::Update { rel_path } | IndexAction::Remove { rel_path } => {
                    guard.insert(rel_path.clone(), action);
                }
                IndexAction::Rename { new_path, old_path } => {
                    guard.remove(old_path);
                    guard.insert(new_path.clone(), action);
                }
            }
        }

        // Mark all replayed entries as done in WAL
        if let Ok(conn) = rusqlite::Connection::open(&db_path) {
            for (id, _) in &pending_entries {
                let _ = crate::wal::mark_done(&conn, *id);
            }
        }
    }

    /// Apply a batch of index actions. Shared by the interval loop and flush_pending.
    async fn apply_actions(indexer: &mut Indexer, actions: Vec<IndexAction>) {
        let mut success_count = 0;
        let mut error_count = 0;

        for action in actions {
            let result = match action {
                IndexAction::Update { rel_path } => {
                    indexer.index_file(&rel_path).await.map(|count| {
                        log::debug!("[IndexSync] Updated: {} ({} chunks)", rel_path, count);
                    })
                }
                IndexAction::Remove { rel_path } => {
                    indexer.remove_file(&rel_path).await.map(|_| {
                        log::debug!("[IndexSync] Removed: {}", rel_path);
                    })
                }
                IndexAction::Rename { old_path, new_path } => indexer
                    .update_file_path(&old_path, &new_path)
                    .await
                    .map(|_| {
                        log::debug!("[IndexSync] Renamed: {} -> {}", old_path, new_path);
                    }),
            };

            match result {
                Ok(_) => success_count += 1,
                Err(e) => {
                    log::warn!("[IndexSync] Error: {}", e);
                    error_count += 1;
                }
            }
        }

        if success_count > 0 {
            if let Err(e) = indexer.update_metadata().await {
                log::warn!("[IndexSync] Failed to update metadata: {}", e);
            }
        }

        log::info!(
            "[IndexSync] Batch complete: {} success, {} errors",
            success_count,
            error_count
        );
    }
}
