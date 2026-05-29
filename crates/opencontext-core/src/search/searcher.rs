//! Search executor
//! Aligned with Node.js searcher.js implementation

use std::collections::{HashMap, HashSet};

use super::bm25_store::Bm25Store;
use super::config::SearchConfig;
use super::embedding::EmbeddingClient;
use super::error::SearchResult;
use super::types::{AggregateBy, MatchType, SearchHit, SearchMode, SearchOptions, SearchResults};
use super::vector_store::VectorStore;

/// RRF constant, typically 60
const RRF_K: f32 = 60.0;

/// Vector search weight in hybrid mode
const VECTOR_WEIGHT: f32 = 0.7;

/// Keyword search weight in hybrid mode  
const KEYWORD_WEIGHT: f32 = 0.3;

/// Search executor
pub struct Searcher {
    #[allow(dead_code)]
    config: SearchConfig,
    vector_store: VectorStore,
    embedding_client: EmbeddingClient,
    bm25_store: Bm25Store,
}

impl Searcher {
    /// Create a new searcher
    pub async fn new(config: SearchConfig) -> SearchResult<Self> {
        let lancedb_path = config.paths.get_lancedb_path();
        let bm25_path = config.paths.get_bm25_path();
        let dimensions = config.embedding.dimensions;

        let mut vector_store = VectorStore::new(lancedb_path, dimensions);
        vector_store.initialize().await?;

        let embedding_client = EmbeddingClient::new(config.embedding.clone())?;
        let bm25_store = Bm25Store::open(bm25_path)?;

        Ok(Self {
            config,
            vector_store,
            embedding_client,
            bm25_store,
        })
    }

    /// Execute a search
    pub async fn search(&self, options: SearchOptions) -> SearchResult<SearchResults> {
        let query = options.query.trim();

        if query.is_empty() {
            return Ok(SearchResults::empty(query.to_string()));
        }

        // Check if index exists
        if !self.vector_store.exists().await {
            return Ok(SearchResults::index_not_built(query.to_string()));
        }

        let limit = options.limit();
        let mode = options.mode();
        let aggregate_by = options.aggregate_by();

        // For aggregation, get more candidates
        let search_limit = if aggregate_by == AggregateBy::Content {
            limit
        } else {
            limit * 5
        };

        // Execute search based on mode
        let mut hits = match mode {
            SearchMode::Vector => self.vector_search(query, search_limit).await?,
            SearchMode::Keyword => self.keyword_search(query, search_limit),
            SearchMode::Hybrid => self.hybrid_search(query, search_limit).await?,
        };

        if let Some(filter_type) = options.doc_type.as_deref() {
            hits.retain(|hit| match filter_type {
                "idea" => hit.doc_type.as_deref() == Some("idea"),
                "doc" => hit.doc_type.as_deref().unwrap_or("doc") == "doc",
                _ => true,
            });
        }

        if let Some(ref prefix) = options.folder_filter {
            let prefix = prefix.trim_end_matches('/');
            hits.retain(|hit| {
                hit.file_path.starts_with(prefix)
                    && (hit.file_path.len() == prefix.len()
                        || hit.file_path.as_bytes().get(prefix.len()) == Some(&b'/'))
            });
        }

        if let Some(from) = options.date_from.as_deref() {
            hits.retain(|hit| hit.entry_date.as_deref().map_or(true, |d| d >= from));
        }

        if let Some(to) = options.date_to.as_deref() {
            hits.retain(|hit| hit.entry_date.as_deref().map_or(true, |d| d <= to));
        }

        if let Some(min_score) = options.min_score {
            hits.retain(|hit| hit.score >= min_score);
        }

        // Expand top results with neighboring chunks
        let neighbor_window = options.include_neighbors.unwrap_or(0);
        if neighbor_window > 0 && aggregate_by == AggregateBy::Content {
            hits = self.expand_with_neighbors(hits, neighbor_window, limit);
        }

        // Aggregate results
        let results = match aggregate_by {
            AggregateBy::Content => hits.into_iter().take(limit).collect(),
            AggregateBy::Doc => self.aggregate_by_doc(hits, limit),
            AggregateBy::Folder => self.aggregate_by_folder(hits, limit),
        };

        // Convert mode and aggregate_by to strings for response
        let mode_str = match mode {
            SearchMode::Vector => "vector",
            SearchMode::Keyword => "keyword",
            SearchMode::Hybrid => "hybrid",
        };
        let aggregate_str = match aggregate_by {
            AggregateBy::Content => "content",
            AggregateBy::Doc => "doc",
            AggregateBy::Folder => "folder",
        };

        Ok(SearchResults {
            query: query.to_string(),
            count: results.len(),
            results,
            mode: Some(mode_str.to_string()),
            aggregate_by: Some(aggregate_str.to_string()),
            index_missing: None,
            error: None,
        })
    }

    /// Perform vector search
    async fn vector_search(&self, query: &str, limit: usize) -> SearchResult<Vec<SearchHit>> {
        // Generate query embedding
        let query_vector = self.embedding_client.embed_one(query).await?;

        // Search vector store
        let mut results = self.vector_store.search(&query_vector, limit).await?;

        // Mark as vector match
        for hit in &mut results {
            hit.matched_by = MatchType::Vector;
        }

        Ok(results)
    }

    /// Keyword search via tantivy BM25 index
    fn keyword_search(&self, query: &str, limit: usize) -> Vec<SearchHit> {
        self.bm25_store.search(query, limit).unwrap_or_default()
    }

    /// Perform hybrid search using RRF (Reciprocal Rank Fusion)
    async fn hybrid_search(&self, query: &str, limit: usize) -> SearchResult<Vec<SearchHit>> {
        let candidate_limit = limit * 3;

        // Execute both searches
        let vector_results = self.vector_search(query, candidate_limit).await?;
        let keyword_results = self.keyword_search(query, candidate_limit);

        // Use RRF to fuse results
        let fused = self.rrf_fusion(vector_results, keyword_results, limit);

        Ok(fused)
    }

    /// Reciprocal Rank Fusion (RRF) — standard rank-based fusion (Cormack 2009).
    /// Score = 1/(k+rank_vector) + 1/(k+rank_keyword).
    /// Key = content hash so same chunk from both lists merges correctly.
    fn rrf_fusion(
        &self,
        vector_results: Vec<SearchHit>,
        keyword_results: Vec<SearchHit>,
        limit: usize,
    ) -> Vec<SearchHit> {
        struct FusedEntry {
            score: f32,
            hit: SearchHit,
            has_vector: bool,
            has_keyword: bool,
        }

        // Key: file_path + content fingerprint (first 64 chars) for stable dedup
        let chunk_key = |h: &SearchHit| {
            let content_prefix: String = h.content.chars().take(64).collect();
            format!("{}|{}", h.file_path, content_prefix)
        };

        let mut scores: HashMap<String, FusedEntry> = HashMap::new();

        for (rank, hit) in vector_results.into_iter().enumerate() {
            let key = chunk_key(&hit);
            let rrf = 1.0 / (RRF_K + rank as f32 + 1.0);
            scores
                .entry(key)
                .and_modify(|e| {
                    e.score += rrf;
                    e.has_vector = true;
                })
                .or_insert(FusedEntry {
                    score: rrf,
                    hit: SearchHit {
                        matched_by: MatchType::Vector,
                        ..hit
                    },
                    has_vector: true,
                    has_keyword: false,
                });
        }

        for (rank, hit) in keyword_results.into_iter().enumerate() {
            let key = chunk_key(&hit);
            let rrf = 1.0 / (RRF_K + rank as f32 + 1.0);
            scores
                .entry(key)
                .and_modify(|e| {
                    e.score += rrf;
                    e.has_keyword = true;
                })
                .or_insert(FusedEntry {
                    score: rrf,
                    hit: SearchHit {
                        matched_by: MatchType::Keyword,
                        ..hit
                    },
                    has_vector: false,
                    has_keyword: true,
                });
        }

        // Normalize scores to [0,1] and set matched_by
        let max_score = scores.values().map(|e| e.score).fold(0.0_f32, f32::max);

        let mut results: Vec<SearchHit> = scores
            .into_values()
            .map(|entry| {
                let matched_by = match (entry.has_vector, entry.has_keyword) {
                    (true, true) => MatchType::Hybrid,
                    (true, false) => MatchType::Vector,
                    _ => MatchType::Keyword,
                };
                let norm_score = if max_score > 0.0 {
                    entry.score / max_score
                } else {
                    0.0
                };
                SearchHit {
                    score: norm_score,
                    matched_by,
                    ..entry.hit
                }
            })
            .collect();

        results.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        results.truncate(limit);
        results
    }

    /// Aggregate results by document
    /// Uses weighted score formula matching Node.js:
    /// score = topScore * 0.6 + min(hitCount/5, 1) * topScore * 0.4
    fn aggregate_by_doc(&self, hits: Vec<SearchHit>, limit: usize) -> Vec<SearchHit> {
        struct DocAgg {
            file_path: String,
            display_name: String,
            top_score: f32,
            hit_count: usize,
            top_chunk: SearchHit,
        }

        let mut doc_map: HashMap<String, DocAgg> = HashMap::new();

        for hit in hits {
            let display_name = hit
                .file_path
                .split('/')
                .next_back()
                .unwrap_or(&hit.file_path)
                .trim_end_matches(".md")
                .to_string();

            let entry = doc_map
                .entry(hit.file_path.clone())
                .or_insert_with(|| DocAgg {
                    file_path: hit.file_path.clone(),
                    display_name: display_name.clone(),
                    top_score: 0.0,
                    hit_count: 0,
                    top_chunk: hit.clone(),
                });

            entry.hit_count += 1;

            // Update with best chunk
            if hit.score > entry.top_score {
                entry.top_score = hit.score;
                entry.top_chunk = hit;
            }
        }

        // Calculate aggregated scores and build results
        let mut results: Vec<SearchHit> = doc_map
            .into_values()
            .map(|doc| {
                // Aggregated score: weighted combination of top score and hit count
                // score = topScore * 0.6 + min(hitCount/5, 1) * topScore * 0.4
                let hit_bonus = (doc.hit_count as f32 / 5.0).min(1.0);
                let aggregated_score = doc.top_score * 0.6 + hit_bonus * doc.top_score * 0.4;

                SearchHit {
                    file_path: doc.file_path,
                    display_name: doc.display_name,
                    content: doc.top_chunk.content,
                    heading_path: doc.top_chunk.heading_path,
                    section_title: doc.top_chunk.section_title,
                    line_start: doc.top_chunk.line_start,
                    line_end: doc.top_chunk.line_end,
                    score: aggregated_score,
                    matched_by: doc.top_chunk.matched_by,
                    hit_count: Some(doc.hit_count),
                    doc_count: None,
                    folder_path: None,
                    aggregate_type: Some("doc".to_string()),
                    doc_type: doc.top_chunk.doc_type,
                    entry_id: None,
                    entry_date: None,
                    entry_created_at: None,
                    idea_box: doc.top_chunk.idea_box,
                }
            })
            .collect();

        results.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        results.truncate(limit);
        results
    }

    /// Aggregate results by folder
    /// Uses weighted score formula matching Node.js:
    /// score = topScore * 0.5 + min(hitCount/10, 1) * topScore * 0.3 + min(docCount/3, 1) * topScore * 0.2
    fn aggregate_by_folder(&self, hits: Vec<SearchHit>, limit: usize) -> Vec<SearchHit> {
        struct FolderAgg {
            folder_path: String,
            display_name: String,
            top_score: f32,
            hit_count: usize,
            docs: HashSet<String>,
            top_chunk: SearchHit,
        }

        let mut folder_map: HashMap<String, FolderAgg> = HashMap::new();

        for hit in hits {
            let folder_path = hit
                .file_path
                .rsplit_once('/')
                .map(|(folder, _)| folder.to_string())
                .unwrap_or_else(|| ".".to_string());

            let display_name = if folder_path == "." {
                "(root)".to_string()
            } else {
                folder_path
                    .split('/')
                    .next_back()
                    .unwrap_or(&folder_path)
                    .to_string()
            };

            let entry = folder_map
                .entry(folder_path.clone())
                .or_insert_with(|| FolderAgg {
                    folder_path: folder_path.clone(),
                    display_name,
                    top_score: 0.0,
                    hit_count: 0,
                    docs: HashSet::new(),
                    top_chunk: hit.clone(),
                });

            entry.hit_count += 1;
            entry.docs.insert(hit.file_path.clone());

            if hit.score > entry.top_score {
                entry.top_score = hit.score;
                entry.top_chunk = hit;
            }
        }

        // Calculate aggregated scores and build results
        let mut results: Vec<SearchHit> = folder_map
            .into_values()
            .map(|folder| {
                // Aggregated score: weighted combination
                // score = topScore * 0.5 + min(hitCount/10, 1) * topScore * 0.3 + min(docCount/3, 1) * topScore * 0.2
                let hit_bonus = (folder.hit_count as f32 / 10.0).min(1.0);
                let doc_bonus = (folder.docs.len() as f32 / 3.0).min(1.0);
                let aggregated_score = folder.top_score * 0.5
                    + hit_bonus * folder.top_score * 0.3
                    + doc_bonus * folder.top_score * 0.2;

                SearchHit {
                    file_path: folder.top_chunk.file_path,
                    display_name: folder.display_name,
                    content: folder.top_chunk.content,
                    heading_path: folder.top_chunk.heading_path,
                    section_title: folder.top_chunk.section_title,
                    line_start: folder.top_chunk.line_start,
                    line_end: folder.top_chunk.line_end,
                    score: aggregated_score,
                    matched_by: folder.top_chunk.matched_by,
                    hit_count: Some(folder.hit_count),
                    doc_count: Some(folder.docs.len()),
                    folder_path: Some(folder.folder_path),
                    aggregate_type: Some("folder".to_string()),
                    doc_type: folder.top_chunk.doc_type,
                    entry_id: None,
                    entry_date: None,
                    entry_created_at: None,
                    idea_box: folder.top_chunk.idea_box,
                }
            })
            .collect();

        results.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        results.truncate(limit);
        results
    }

    /// Expand top search hits by fetching neighboring chunks from the same file.
    /// For each unique (file_path) in top hits, fetches `window` chunks before and after
    /// the matched chunk and stitches them into the hit's content.
    fn expand_with_neighbors(
        &self,
        hits: Vec<SearchHit>,
        window: usize,
        limit: usize,
    ) -> Vec<SearchHit> {
        // Cache of file chunks to avoid re-fetching same file
        let mut file_cache: HashMap<String, Vec<SearchHit>> = HashMap::new();
        let mut expanded = Vec::with_capacity(hits.len());

        for hit in hits.into_iter().take(limit) {
            let file_chunks = file_cache.entry(hit.file_path.clone()).or_insert_with(|| {
                self.bm25_store
                    .get_chunks_by_file(&hit.file_path)
                    .unwrap_or_default()
            });

            if file_chunks.is_empty() {
                expanded.push(hit);
                continue;
            }

            // Find the matching chunk by content
            let matched_idx = file_chunks
                .iter()
                .position(|c| c.content == hit.content)
                .unwrap_or(0);

            let start = matched_idx.saturating_sub(window);
            let end = (matched_idx + window + 1).min(file_chunks.len());

            let context: String = file_chunks[start..end]
                .iter()
                .map(|c| c.content.as_str())
                .collect::<Vec<_>>()
                .join("\n\n");

            expanded.push(SearchHit {
                content: context,
                ..hit
            });
        }

        expanded
    }

    /// Check if index is built
    pub async fn index_exists(&self) -> bool {
        self.vector_store.exists().await
    }
}
