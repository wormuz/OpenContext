#!/usr/bin/env node

const path = require('path');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const z = require('zod');
const store = require('../core/store/index.js');
const { Searcher, Indexer } = require('../core/search/index.js');

const server = new McpServer({
  name: 'opencontext-mcp',
  version: '0.1.0'
});

function toToolResponse(data) {
  // Wrap arrays in object to comply with MCP structuredContent requirement (must be record, not array)
  const structured = Array.isArray(data) ? { items: data } : data;
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(data, null, 2)
      }
    ],
    structuredContent: structured
  };
}

server.registerTool(
  'oc_list_folders',
  {
    description: 'List folders in OpenContext (top-level by default, full tree with scope=all). For most workflows prefer oc_manifest (if you know the folder name) or oc_search (content search) — they are the primary discovery tools. This raw folder listing is mainly for bootstrapping when nothing is known yet.',
    inputSchema: z.object({
      scope: z.enum(['root', 'all']).optional().describe('Default "root" returns only top-level folders. "all" returns the full nested tree.')
    })
  },
  async ({ scope }) => {
    const folders = store.listFolders({ all: scope === 'all' });
    return toToolResponse(folders);
  }
);

server.registerTool(
  'oc_list_docs',
  {
    description: 'List documents directly inside a folder (or recursively with recursive=true). For most cases prefer oc_manifest — it returns the same data plus warns about unindexed files. Use oc_list_docs only when you specifically need the lightweight listing without the unindexed_files check.',
    inputSchema: z.object({
      folder_path: z.string().min(1).describe('Folder path relative to contexts/, e.g. "project-a/design"'),
      recursive: z.boolean().optional().describe('Include subfolders recursively. Default false (only direct children).')
    })
  },
  async ({ folder_path, recursive }) => {
    const docs = store.listDocs({ folderPath: folder_path, recursive: Boolean(recursive) });
    return toToolResponse(docs);
  }
);

server.registerTool(
  'oc_create_doc',
  {
    description:
      'REQUIRED for any file under ~/.opencontext/contexts/. Using Write or Edit there bypasses the SQLite index — the file becomes invisible to oc_manifest and oc_search. Always use this tool to create docs, oc_save_doc to write/replace body, and oc_set_doc_desc to update description. Creates an empty document (with optional description) in the given folder.',
    inputSchema: z.object({
      folder_path: z.string().min(1).describe('PARENT folder, relative to contexts/. The doc will be created as folder_path/doc_name. Contrast with oc_folder_create whose folder_path is the FULL new path (parent+leaf in one string).'),
      doc_name: z.string().min(1).describe('Leaf file name including extension, e.g. "plan.md"'),
      description: z.string().optional().describe('Document description (1-2 sentences: what is inside, why it exists, when to use it)')
    })
  },
  async ({ folder_path, doc_name, description }) => {
    const result = store.createDoc({ folderPath: folder_path, name: doc_name, description: description || '' });
    return toToolResponse(result);
  }
);

server.registerTool(
  'oc_set_doc_desc',
  {
    description:
      'Update a document description. REQUIRED for metadata edits under ~/.opencontext/contexts/ — Write/Edit on the .md file there bypasses the SQLite index. Use oc_create_doc to create, this tool to update description, and oc_save_doc to update body.',
    inputSchema: z.object({
      doc_path: z.string().min(1).describe('Document path, e.g. "project-a/plan.md"'),
      description: z.string().describe('New description text')
    })
  },
  async ({ doc_path, description }) => {
    const result = store.setDocDescription({ docPath: doc_path, description });
    return toToolResponse(result);
  }
);

server.registerTool(
  'oc_save_doc',
  {
    description:
      'Write/replace the body of a document under ~/.opencontext/contexts/. Keeps SQLite index, updated_at, and search embeddings in sync. The doc must already exist (use oc_create_doc first). Optionally updates the description in the same call.\n\n' +
      'DECISION TREE — choose by file size:\n' +
      '• ≤300 lines / ≤25 KB → use THIS tool (oc_save_doc): pass full content, index updates atomically.\n' +
      '• >300 lines / >25 KB → use Edit/Write on the abs_path, THEN call oc_reconcile_doc(doc_path): Edit is unbounded, reconcile resyncs SQLite + embeddings.\n\n' +
      'WHY the split: the `content` param passes through the LLM output-token budget (≈8192 tokens total for all tool-call params). Files over ~25 KB hit this ceiling and fail with a silent stop_sequence truncation — the write appears to succeed but content is cut off. oc_reconcile_doc has no content param so it is safe for any file size.',
    inputSchema: z.object({
      doc_path: z.string().min(1).describe('Document path relative to contexts/, e.g. "project-a/plan.md"'),
      content: z.string().describe('Full new file content (replaces existing body). Hard cap ≈25 KB — for larger files use oc_reconcile_doc after disk edit.'),
      description: z.string().optional().describe('Optional new description; leave empty to keep current')
    })
  },
  async ({ doc_path, content, description }) => {
    const result = store.saveDocContent({
      docPath: doc_path,
      content,
      description,
    });
    return toToolResponse(result);
  }
);

server.registerTool(
  'oc_reconcile_doc',
  {
    description:
      'Resync a single document\'s SQLite index entry + search embeddings after the `.md` was edited directly on disk (via Write/Edit/sed/Bash heredoc). Path-only API: avoids passing full content through the caller\'s tool-call token budget, so it works for arbitrarily large files (unlike oc_save_doc which is bounded by ≈8192 output tokens ≈ 25 KB).\n\n' +
      'Use when: (a) you edited the file directly with Write/Edit and need to refresh the index; (b) the expected content is larger than oc_save_doc can carry through the model\'s output stream; (c) you ran sed/awk/script transformations on the file and need to commit the result to SQLite. The doc must already exist (use oc_create_doc + oc_save_doc for fresh docs, or write the file then call reconcile).\n\n' +
      'Workflow: 1) edit the file on disk → 2) call oc_reconcile_doc with the doc_path → 3) SQLite updated_at bumps + search index recomputes embeddings.',
    inputSchema: z.object({
      doc_path: z.string().min(1).describe('Document path relative to contexts/, e.g. "project-a/plan.md". File must already exist on disk and be registered in SQLite.'),
      description: z.string().optional().describe('Optional new description; omit to keep current')
    })
  },
  async ({ doc_path, description }) => {
    const result = store.reconcileDoc({
      docPath: doc_path,
      description,
    });
    return toToolResponse(result);
  }
);

server.registerTool(
  'oc_delete_doc',
  {
    description:
      'Delete a document under ~/.opencontext/contexts/. Removes both the .md file on disk AND its SQLite index entry (atomic). REQUIRED instead of plain `rm` — bare `rm` leaves a stale SQLite row that oc_manifest will keep reporting. Use this when retiring a doc; if you only want to relocate it, use oc_create_doc + oc_save_doc at the new path, then oc_delete_doc at the old path.',
    inputSchema: z.object({
      doc_path: z.string().min(1).describe('Document path relative to contexts/, e.g. "project-a/plan.md"')
    })
  },
  async ({ doc_path }) => {
    const result = store.removeDoc({ docPath: doc_path });
    return toToolResponse(result);
  }
);

server.registerTool(
  'oc_manifest',
  {
    description:
      'List all docs in a folder (recursive). Use this when you know the project/folder name — oc_search matches content only, not names. Returns { items, unindexed_files }: `items` are docs registered in SQLite; `unindexed_files` lists *.md files present on disk but missing from the index (created via Write/Edit, bypassing oc_create_doc). When `unindexed_files` is non-empty, run oc_reconcile_folder.',
    inputSchema: z.object({
      folder_path: z.string().min(1).describe('Folder path relative to contexts/'),
      limit: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Optional cap on number of items returned')
    })
  },
  async ({ folder_path, limit }) => {
    let result;
    try {
      result = store.generateManifest({ folderPath: folder_path, limit });
    } catch (err) {
      if (err && err.message && err.message.includes('does not exist')) {
        const suggestions = store.suggestFolders({ query: folder_path });
        if (suggestions && suggestions.length > 0) {
          const list = suggestions.map(s => `"${s}"`).join(', ');
          throw new Error(
            `Folder "${folder_path}" not found. Did you mean: ${list}? ` +
            `Call oc_manifest again with the correct folder_path.`
          );
        }
      }
      throw err;
    }
    const unindexed = result.unindexed_files || [];
    const payload = {
      items: result.items,
      unindexed_files: unindexed,
    };
    if (unindexed.length > 0) {
      payload.warning =
        `${unindexed.length} files exist on disk but are not indexed. ` +
        `Call oc_reconcile_folder({ folder_path: "${folder_path}" }) to register them, ` +
        `or delete them. Files: ${unindexed.join(', ')}`;
    }
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(payload, null, 2),
        },
      ],
      structuredContent: payload,
    };
  }
);

server.registerTool(
  'oc_reconcile_folder',
  {
    description:
      'Two-way reconcile of `*.md` files under ~/.opencontext/contexts/<folder_path> with the SQLite index. (a) INSERTs docs rows for files present on disk but missing from the index — e.g. created via Write/Edit, or pulled from git. (b) DELETEs docs rows whose file no longer exists on disk — e.g. removed via plain `rm`. Fast — does NOT recompute embeddings (run `oc index build` for that). Returns { added, removed, count }. Use after oc_manifest reports `unindexed_files`, after pulling docs from git, or after rm-ing files outside of oc_delete_doc.',
    inputSchema: z.object({
      folder_path: z.string().min(1).describe('Folder path relative to contexts/')
    })
  },
  async ({ folder_path }) => {
    const report = store.reconcileFolder({ folderPath: folder_path });
    const added = report.added || [];
    const removed = report.removed || [];
    const total = added.length + removed.length;
    let hint;
    if (total === 0) {
      hint = 'No drift detected.';
    } else {
      const parts = [];
      if (added.length > 0) parts.push('Run `oc index build` to compute embeddings for the new docs.');
      if (removed.length > 0) parts.push(`${removed.length} stale index entry/entries pruned (file(s) gone from disk).`);
      hint = parts.join(' ');
    }
    const payload = {
      added,
      removed,
      count: total,
      hint,
    };
    return toToolResponse(payload);
  }
);

// ===== P0: oc_search =====
server.registerTool(
  'oc_search',
  {
    description: 'Search OpenContext documents by CONTENT using hybrid semantic + keyword search (BM25 + vector embeddings, RRF fusion). Understands natural language queries — not just exact keywords. Does NOT match folder names or file names — to browse a known project use oc_manifest({ folder_path: "project-name" }) instead. Returns matching content/docs/folders with file paths and stable_ids for citation. Default mode is "hybrid" (recommended); use "vector" for pure semantic similarity, "keyword" for exact BM25 only.',
    inputSchema: z.object({
      query: z.string().min(1).describe('Search query (keywords or natural language)'),
      limit: z.number().int().positive().optional().describe('Number of results (default 5)'),
      mode: z.enum(['hybrid', 'vector', 'keyword']).optional().describe('Search mode (default hybrid)'),
      type: z.enum(['content', 'doc', 'folder']).optional().describe('Aggregation type (default content)'),
      folder_filter: z.string().optional().describe('Restrict search to this folder prefix, e.g. "Product/opencontext". Keeps results scoped to one project.'),
      min_score: z.number().min(0).max(1).optional().describe('Minimum relevance score 0–1. Results below this are dropped. Recommended: 0.3–0.5 to cut noise.'),
      date_from: z.string().optional().describe('Filter idea entries on or after this date (YYYY-MM-DD). Only affects idea/journal docs.'),
      date_to: z.string().optional().describe('Filter idea entries on or before this date (YYYY-MM-DD). Only affects idea/journal docs.'),
      include_neighbors: z.number().int().min(0).max(3).optional().describe('Include N neighboring chunks around each top match for richer context (0=disabled, 1=recommended). Stitches surrounding paragraphs into the result content.')
    }),
    outputSchema: z.object({
      query: z.string(),
      count: z.number(),
      mode: z.string().optional(),
      aggregate_by: z.string().optional(),
      results: z.array(z.object({
        file_path: z.string(),
        display_name: z.string(),
        content: z.string(),
        score: z.number(),
        matched_by: z.string(),
        heading_path: z.string().optional(),
        section_title: z.string().optional(),
        doc_type: z.string().optional(),
        entry_date: z.string().optional(),
        entry_id: z.string().optional(),
        hit_count: z.number().optional(),
        folder_path: z.string().optional()
      })),
      index_missing: z.boolean().optional(),
      error: z.string().optional()
    })
  },
  async ({ query, limit, mode, type, folder_filter, min_score, date_from, date_to, include_neighbors }) => {
    try {
      const searcher = new Searcher();
      const results = await searcher.search(query, {
        limit: limit ?? 5,
        mode: mode ?? 'hybrid',
        aggregateBy: type ?? 'content',
        folderFilter: folder_filter,
        minScore: min_score,
        dateFrom: date_from,
        dateTo: date_to,
        includeNeighbors: include_neighbors,
      });
      const jsonOutput = searcher.formatResultsJson(query, results, {
        mode: mode ?? 'hybrid',
        aggregateBy: type ?? 'content'
      });
      return toToolResponse(jsonOutput);
    } catch (err) {
      if (err.message && (err.message.includes('index') || err.message.includes('Index'))) {
        return toToolResponse({
          error: 'INDEX_NOT_AVAILABLE',
          message: 'Search index not built. Use `oc index build` to create it, or fall back to oc_manifest for discovery.',
          query
        });
      }
      throw err;
    }
  }
);

// ===== P1: oc_resolve =====
server.registerTool(
  'oc_resolve',
  {
    description: 'Resolve a stable_id (UUID) to the current document path and metadata. Use this to follow oc://doc/<stable_id> links.',
    inputSchema: z.object({
      stable_id: z.string().uuid().describe('Document stable_id (UUID), e.g. from oc://doc/<stable_id>')
    })
  },
  async ({ stable_id }) => {
    const doc = store.getDocByStableId(stable_id);
    return toToolResponse({
      stable_id: doc.stable_id,
      rel_path: doc.rel_path,
      abs_path: doc.abs_path,
      description: doc.description || '',
      updated_at: doc.updated_at
    });
  }
);

// ===== P1: oc_get_link =====
server.registerTool(
  'oc_get_link',
  {
    description: 'Get the stable link (oc://doc/<stable_id>) for a document. Use this when citing documents.',
    inputSchema: z.object({
      doc_path: z.string().min(1).describe('Document path relative to contexts/, e.g. "Product/opencontext/agentic/guide"'),
      label: z.string().optional().describe('Optional label for the markdown link (defaults to filename without extension)')
    })
  },
  async ({ doc_path, label }) => {
    const doc = store.getDocMeta({ docPath: doc_path });
    if (!doc.stable_id) {
      throw new Error('stable_id not found. Run `oc init` to ensure schema migration has completed.');
    }
    const linkLabel = label || path.basename(doc.rel_path).replace(/\.md$/i, '');
    const url = `oc://doc/${doc.stable_id}`;
    return toToolResponse({
      stable_id: doc.stable_id,
      url,
      markdown_link: `[${linkLabel}](${url})`,
      rel_path: doc.rel_path,
      abs_path: doc.abs_path
    });
  }
);

// ===== P2: oc_folder_create =====
server.registerTool(
  'oc_folder_create',
  {
    description: 'Create a new folder in OpenContext. IMPORTANT: pass the FULL path of the new folder (parent + new leaf name combined as one string) — UNLIKE oc_create_doc which splits parent (folder_path) and leaf (doc_name) into two parameters. Safe to call if folder already exists.',
    inputSchema: z.object({
      folder_path: z.string().min(1).describe('FULL path of the new folder relative to contexts/, including the new folder name as the last segment. Example: "Product/opencontext/ideas" creates folder "ideas" inside "Product/opencontext/". No separate name parameter (unlike oc_create_doc).'),
      description: z.string().optional().describe('Optional folder description')
    })
  },
  async ({ folder_path, description }) => {
    const result = store.createFolder({ path: folder_path, description: description || '' });
    return toToolResponse({
      rel_path: result.rel_path,
      abs_path: result.abs_path,
      description: result.description || ''
    });
  }
);

// ===== P2: oc_index_status =====
server.registerTool(
  'oc_index_status',
  {
    description: 'Check search index status: availability, chunk counts, embedding model name and dimensions, last build time. If index is missing or stale, oc_search falls back to keyword-only (no semantic/vector search). Call this when oc_search results seem poor, or to confirm hybrid search is active. To build/rebuild the index: run `oc index build` in the terminal.',
    inputSchema: z.object({})
  },
  async () => {
    try {
      const indexer = new Indexer();
      await indexer.initialize();
      const exists = await indexer.indexExists();

      if (!exists) {
        return toToolResponse({
          available: false,
          message: 'Search index not found. Run `oc index build` to create it.'
        });
      }

      const info = await indexer.getIndexInfo();
      return toToolResponse({
        available: info.available ?? true,
        vector_chunks: info.vector_chunks ?? 0,
        bm25_docs: info.bm25_docs ?? 0,
        total_docs: info.total_docs ?? 0,
        embedding_model: info.embedding_model ?? 'unknown',
        embedding_dimensions: info.embedding_dimensions ?? 0,
        last_updated: info.last_updated ? new Date(info.last_updated).toISOString() : null
      });
    } catch (err) {
      return toToolResponse({
        available: false,
        message: `Index check failed: ${err.message}`
      });
    }
  }
);

// ===== P2: oc_get_context =====
server.registerTool(
  'oc_get_context',
  {
    description: 'Fetch full document content by stable_id or doc_path. Standard two-step workflow: oc_search → pick relevant docs → oc_get_context to read full text. Avoids token bloat from passing full content through oc_search results. Prefer stable_id (from oc://doc/<id> links or search results) over doc_path — stable_id survives renames.',
    inputSchema: z.object({
      stable_id: z.string().uuid().optional().describe('Document stable_id (UUID) from oc_search result or oc://doc/<id> link'),
      doc_path: z.string().optional().describe('Document path relative to contexts/, e.g. "Product/opencontext/guide"')
    })
  },
  async ({ stable_id, doc_path }) => {
    if (!stable_id && !doc_path) {
      throw new Error('Provide either stable_id or doc_path');
    }
    let meta;
    if (stable_id) {
      meta = store.getDocByStableId(stable_id);
    } else {
      meta = store.getDocMeta({ docPath: doc_path });
    }
    const content = store.getDocContent(meta.abs_path);
    return toToolResponse({
      stable_id: meta.stable_id,
      rel_path: meta.rel_path,
      abs_path: meta.abs_path,
      description: meta.description || '',
      updated_at: meta.updated_at,
      content
    });
  }
);

// ===== P2: oc_index_flush =====
server.registerTool(
  'oc_index_flush',
  {
    description: 'Flush any pending index updates immediately, without waiting for the next 5-minute batch cycle. Use after saving multiple documents when you need oc_search to reflect recent changes right away. No-op if the index sync service is not running.',
    inputSchema: z.object({})
  },
  async () => {
    try {
      const native = require('../core/native');
      if (!native.isAvailable()) {
        return toToolResponse({ flushed: false, message: 'Native bindings not available.' });
      }
      const flushed = native.get().flushIndexSync();
      return toToolResponse({
        flushed,
        message: flushed
          ? 'Flush signal sent — pending updates will be processed immediately.'
          : 'Index sync service is not running; nothing to flush.'
      });
    } catch (err) {
      return toToolResponse({ flushed: false, message: `Flush failed: ${err.message}` });
    }
  }
);

async function startServer(options = {}) {
  store.initEnvironment();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('OpenContext MCP server running (stdio)');

  // Start background index sync service (batches doc events every 5 min)
  // Runs only if index has been built at least once; silently skips if not.
  if (!options.autoExit && process.env.OPENCONTEXT_MCP_TEST !== '1') {
    const native = require('../core/native');
    if (native.isAvailable()) {
      native.get().startIndexSync(null).catch(() => {});
    }
  }

  if (options.autoExit || process.env.OPENCONTEXT_MCP_TEST === '1') {
    setTimeout(() => process.exit(0), 0);
  }
}

module.exports = { startServer };

if (require.main === module) {
  startServer().catch((error) => {
    console.error('OpenContext MCP server failed:', error);
    process.exit(1);
  });
}

