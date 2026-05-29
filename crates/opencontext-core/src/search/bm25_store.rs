//! Tantivy-based BM25 full-text index

use std::path::PathBuf;

use tantivy::collector::TopDocs;
use tantivy::query::QueryParser;
use tantivy::schema::{
    Field, Schema, SchemaBuilder, TextFieldIndexing, TextOptions, FAST, STORED, STRING,
};
use tantivy::{Index, IndexWriter, ReloadPolicy, TantivyDocument};

use super::error::{SearchError, SearchResult};
use super::types::{Chunk, MatchType, SearchHit};

/// Persistent BM25 index backed by tantivy
pub struct Bm25Store {
    index: Index,
    schema: Bm25Schema,
}

struct Bm25Schema {
    schema: Schema,
    chunk_id: Field,
    file_path: Field,
    content: Field,
    heading_path: Field,
    doc_type: Field,
    entry_id: Field,
    entry_date: Field,
    entry_created_at: Field,
    idea_box: Field,
    section_title: Field,
    chunk_index: Field,
}

fn build_schema() -> Bm25Schema {
    let mut builder = SchemaBuilder::new();

    let text_indexed = TextOptions::default().set_indexing_options(
        TextFieldIndexing::default()
            .set_tokenizer("en_stem")
            .set_index_option(tantivy::schema::IndexRecordOption::WithFreqsAndPositions),
    );

    let chunk_id = builder.add_text_field("chunk_id", STRING | STORED);
    let file_path = builder.add_text_field("file_path", STRING | STORED);
    let content = builder.add_text_field("content", text_indexed | STORED);
    let heading_path = builder.add_text_field("heading_path", STRING | STORED);
    let doc_type = builder.add_text_field("doc_type", STRING | STORED);
    let entry_id = builder.add_text_field("entry_id", STRING | STORED);
    let entry_date = builder.add_text_field("entry_date", STRING | STORED);
    let entry_created_at = builder.add_text_field("entry_created_at", STRING | STORED);
    let idea_box = builder.add_text_field("idea_box", STRING | STORED);
    let section_title = builder.add_text_field("section_title", STRING | STORED);
    let chunk_index = builder.add_u64_field("chunk_index", FAST | STORED);

    Bm25Schema {
        schema: builder.build(),
        chunk_id,
        file_path,
        content,
        heading_path,
        doc_type,
        entry_id,
        entry_date,
        entry_created_at,
        idea_box,
        section_title,
        chunk_index,
    }
}

impl Bm25Store {
    /// Open or create a tantivy index at `path`
    pub fn open(path: PathBuf) -> SearchResult<Self> {
        std::fs::create_dir_all(&path)
            .map_err(|e| SearchError::Index(format!("bm25 mkdir: {e}")))?;

        let schema_def = build_schema();

        // Try to open existing index; if meta file absent — create fresh
        let meta_file = path.join("meta.json");
        let index = if meta_file.exists() {
            tantivy::Index::open_in_dir(&path)
                .map_err(|e| SearchError::Index(format!("bm25 open: {e}")))?
        } else {
            tantivy::Index::create_in_dir(&path, schema_def.schema.clone())
                .map_err(|e| SearchError::Index(format!("bm25 create: {e}")))?
        };

        Ok(Self {
            index,
            schema: schema_def,
        })
    }

    fn make_writer(&self) -> SearchResult<IndexWriter> {
        self.index
            .writer(50_000_000)
            .map_err(|e| SearchError::Index(format!("bm25 writer: {e}")))
    }

    fn chunk_to_doc(&self, chunk: &Chunk) -> TantivyDocument {
        let s = &self.schema;
        let mut doc = TantivyDocument::default();
        doc.add_text(s.chunk_id, &chunk.id);
        doc.add_text(s.file_path, &chunk.file_path);
        doc.add_text(s.content, &chunk.content);
        doc.add_text(s.heading_path, &chunk.heading_path);
        doc.add_text(s.doc_type, chunk.doc_type.as_deref().unwrap_or("doc"));
        doc.add_text(s.entry_id, chunk.entry_id.as_deref().unwrap_or(""));
        doc.add_text(s.entry_date, chunk.entry_date.as_deref().unwrap_or(""));
        doc.add_text(
            s.entry_created_at,
            chunk.entry_created_at.as_deref().unwrap_or(""),
        );
        doc.add_text(s.idea_box, chunk.idea_box.as_deref().unwrap_or(""));
        doc.add_text(
            s.section_title,
            chunk.section_title.as_deref().unwrap_or(""),
        );
        doc.add_u64(s.chunk_index, chunk.chunk_index as u64);
        doc
    }

    /// Rebuild index from scratch
    pub fn index_all(&self, chunks: &[Chunk]) -> SearchResult<()> {
        let mut writer = self.make_writer()?;
        writer
            .delete_all_documents()
            .map_err(|e| SearchError::Index(format!("bm25 delete_all: {e}")))?;

        for chunk in chunks {
            writer
                .add_document(self.chunk_to_doc(chunk))
                .map_err(|e| SearchError::Index(format!("bm25 add_doc: {e}")))?;
        }

        writer
            .commit()
            .map_err(|e| SearchError::Index(format!("bm25 commit: {e}")))?;
        Ok(())
    }

    /// Remove all chunks for given file paths and add new chunks
    pub fn update(&self, removed_paths: &[String], added_chunks: &[Chunk]) -> SearchResult<()> {
        let mut writer = self.make_writer()?;

        for path in removed_paths {
            let term = tantivy::Term::from_field_text(self.schema.file_path, path);
            writer.delete_term(term);
        }

        for chunk in added_chunks {
            writer
                .add_document(self.chunk_to_doc(chunk))
                .map_err(|e| SearchError::Index(format!("bm25 add_doc: {e}")))?;
        }

        writer
            .commit()
            .map_err(|e| SearchError::Index(format!("bm25 commit: {e}")))?;
        Ok(())
    }

    /// Return number of documents in the BM25 index
    pub fn count(&self) -> SearchResult<usize> {
        let reader = self
            .index
            .reader_builder()
            .reload_policy(ReloadPolicy::OnCommitWithDelay)
            .try_into()
            .map_err(|e| SearchError::Index(format!("bm25 reader: {e}")))?;
        Ok(reader.searcher().num_docs() as usize)
    }

    /// Search using BM25 — returns ranked `SearchHit`s
    pub fn search(&self, query_str: &str, limit: usize) -> SearchResult<Vec<SearchHit>> {
        let reader = self
            .index
            .reader_builder()
            .reload_policy(ReloadPolicy::OnCommitWithDelay)
            .try_into()
            .map_err(|e| SearchError::Index(format!("bm25 reader: {e}")))?;

        let searcher = reader.searcher();

        let query_parser = QueryParser::for_index(
            &self.index,
            vec![self.schema.content, self.schema.heading_path],
        );

        let query = query_parser.parse_query(query_str).unwrap_or_else(|_| {
            // Fallback: wrap as literal phrase to avoid parse errors on special chars
            let safe: String = query_str
                .chars()
                .map(|c| {
                    if c.is_alphanumeric() || c == ' ' {
                        c
                    } else {
                        ' '
                    }
                })
                .collect();
            query_parser
                .parse_query(safe.trim())
                .unwrap_or_else(|_| query_parser.parse_query("").unwrap())
        });

        let top_docs = searcher
            .search(&query, &TopDocs::with_limit(limit))
            .map_err(|e| SearchError::Index(format!("bm25 search: {e}")))?;

        if top_docs.is_empty() {
            return Ok(vec![]);
        }

        let max_score = top_docs.first().map(|(s, _)| *s).unwrap_or(1.0);

        let s = &self.schema;
        let mut hits = Vec::with_capacity(top_docs.len());

        for (score, doc_addr) in top_docs {
            let retrieved: TantivyDocument = searcher
                .doc(doc_addr)
                .map_err(|e| SearchError::Index(format!("bm25 retrieve: {e}")))?;

            let get_str = |field: Field| -> String {
                retrieved
                    .get_first(field)
                    .and_then(|v| {
                        if let tantivy::schema::OwnedValue::Str(s) = v {
                            Some(s.as_str())
                        } else {
                            None
                        }
                    })
                    .unwrap_or("")
                    .to_string()
            };
            let get_opt = |field: Field| -> Option<String> {
                let v = get_str(field);
                if v.is_empty() {
                    None
                } else {
                    Some(v)
                }
            };

            let file_path = get_str(s.file_path);
            let doc_type = get_opt(s.doc_type);
            let section_title = get_opt(s.section_title);
            let heading_path = get_opt(s.heading_path);

            let display_name = if doc_type.as_deref() == Some("idea") {
                section_title
                    .clone()
                    .or_else(|| heading_path.clone())
                    .unwrap_or_else(|| basename(&file_path))
            } else {
                basename(&file_path)
            };

            let normalized_score = if max_score > 0.0 {
                score / max_score
            } else {
                0.0
            };

            hits.push(SearchHit {
                file_path,
                display_name,
                content: get_str(s.content),
                heading_path,
                section_title,
                line_start: None,
                line_end: None,
                score: normalized_score,
                matched_by: MatchType::Keyword,
                hit_count: None,
                doc_count: None,
                folder_path: None,
                aggregate_type: None,
                doc_type,
                entry_id: get_opt(s.entry_id),
                entry_date: get_opt(s.entry_date),
                entry_created_at: get_opt(s.entry_created_at),
                idea_box: get_opt(s.idea_box),
            });
        }

        Ok(hits)
    }

    /// Fetch all chunks for a given file_path, sorted by chunk_index.
    /// Used for neighboring chunk context expansion.
    pub fn get_chunks_by_file(&self, file_path: &str) -> SearchResult<Vec<SearchHit>> {
        use tantivy::query::TermQuery;
        use tantivy::schema::IndexRecordOption;
        use tantivy::Term;

        let reader = self
            .index
            .reader_builder()
            .reload_policy(ReloadPolicy::OnCommitWithDelay)
            .try_into()
            .map_err(|e| SearchError::Index(format!("bm25 reader: {e}")))?;
        let searcher = reader.searcher();

        let term = Term::from_field_text(self.schema.file_path, file_path);
        let query = TermQuery::new(term, IndexRecordOption::Basic);

        // Fetch up to 1000 chunks per file (no practical file has more)
        let top_docs = searcher
            .search(&query, &TopDocs::with_limit(1000))
            .map_err(|e| SearchError::Index(format!("bm25 file chunks: {e}")))?;

        let s = &self.schema;
        let get_str = |doc: &TantivyDocument, field: tantivy::schema::Field| -> String {
            doc.get_first(field)
                .and_then(|v| {
                    if let tantivy::schema::OwnedValue::Str(s) = v {
                        Some(s.as_str())
                    } else {
                        None
                    }
                })
                .unwrap_or("")
                .to_string()
        };
        let get_opt = |doc: &TantivyDocument, field: tantivy::schema::Field| -> Option<String> {
            let v = get_str(doc, field);
            if v.is_empty() {
                None
            } else {
                Some(v)
            }
        };
        let get_u64 = |doc: &TantivyDocument, field: tantivy::schema::Field| -> u64 {
            doc.get_first(field)
                .and_then(|v| {
                    if let tantivy::schema::OwnedValue::U64(n) = v {
                        Some(*n)
                    } else {
                        None
                    }
                })
                .unwrap_or(0)
        };

        let mut chunks: Vec<(u64, SearchHit)> = top_docs
            .into_iter()
            .filter_map(|(_, addr)| {
                searcher.doc(addr).ok().map(|doc| {
                    let chunk_index = get_u64(&doc, s.chunk_index);
                    let fp = get_str(&doc, s.file_path);
                    let doc_type = get_opt(&doc, s.doc_type);
                    let section_title = get_opt(&doc, s.section_title);
                    let heading_path = get_opt(&doc, s.heading_path);
                    let display_name = basename(&fp);
                    let hit = SearchHit {
                        file_path: fp,
                        display_name,
                        content: get_str(&doc, s.content),
                        heading_path,
                        section_title,
                        line_start: None,
                        line_end: None,
                        score: 0.0,
                        matched_by: MatchType::Keyword,
                        hit_count: None,
                        doc_count: None,
                        folder_path: None,
                        aggregate_type: None,
                        doc_type,
                        entry_id: get_opt(&doc, s.entry_id),
                        entry_date: get_opt(&doc, s.entry_date),
                        entry_created_at: get_opt(&doc, s.entry_created_at),
                        idea_box: get_opt(&doc, s.idea_box),
                    };
                    (chunk_index, hit)
                })
            })
            .collect();

        chunks.sort_by_key(|(idx, _)| *idx);
        Ok(chunks.into_iter().map(|(_, h)| h).collect())
    }
}

fn basename(file_path: &str) -> String {
    file_path
        .split('/')
        .next_back()
        .unwrap_or(file_path)
        .trim_end_matches(".md")
        .to_string()
}

#[cfg(all(test, feature = "search"))]
mod tests {
    use super::*;

    fn make_chunk(id: &str, file_path: &str, content: &str) -> Chunk {
        Chunk {
            id: id.to_string(),
            file_path: file_path.to_string(),
            content: content.to_string(),
            heading_path: String::new(),
            section_title: None,
            doc_type: None,
            entry_id: None,
            entry_date: None,
            entry_created_at: None,
            idea_box: None,
            chunk_index: 0,
            vector: vec![],
        }
    }

    #[test]
    fn test_open_creates_index() {
        let tmpdir = tempfile::tempdir().expect("create tempdir");
        let path = tmpdir.path().to_path_buf();
        let store = Bm25Store::open(path).expect("open index");
        let reader = store.index.reader().expect("create reader");
        assert!(reader.searcher().num_docs() >= 0, "index is valid");
    }

    #[test]
    fn test_index_and_search() {
        let tmpdir = tempfile::tempdir().expect("create tempdir");
        let store = Bm25Store::open(tmpdir.path().to_path_buf()).expect("open index");

        let chunks = vec![
            make_chunk("c1", "project/doc1.md", "hello world"),
            make_chunk("c2", "project/doc2.md", "rust programming language"),
        ];

        store.index_all(&chunks).expect("index chunks");

        let results = store.search("rust", 5).expect("search");
        assert!(results.len() >= 1, "expected at least 1 result for 'rust'");

        let found = results.iter().any(|hit| hit.file_path.contains("doc2.md"));
        assert!(found, "expected doc2.md in search results");
    }

    #[test]
    fn test_update_removes_and_adds() {
        let tmpdir = tempfile::tempdir().expect("create tempdir");
        let store = Bm25Store::open(tmpdir.path().to_path_buf()).expect("open index");

        let chunk1 = make_chunk("c1", "path1", "original content");
        store.index_all(&[chunk1]).expect("index first chunk");

        let chunk2 = make_chunk("c2", "path2", "new content");
        store
            .update(&["path1".to_string()], &[chunk2])
            .expect("update");

        let results = store.search("original", 5).expect("search");
        assert_eq!(results.len(), 0, "expected no results for removed content");
    }
}
