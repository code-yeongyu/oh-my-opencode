# Comment-Checker TypeScript Port Implementation Plan

## 1. Architecture Overview

### 1.1 Core Challenges

**OpenCode Hook Constraints:**
- `tool.execute.before`: File path/content accessible via `output.args`
- `tool.execute.after`: `tool_input` is **NOT provided** (key difference from Claude Code)
- **Solution**: Capture data in Before hook, store in Map keyed by callID, retrieve in After hook

### 1.2 Directory Structure

```
src/hooks/comment-checker/
├── index.ts              # Hook factory, main entry point
├── types.ts              # All type definitions
├── constants.ts          # Language registry, query templates, directive list
├── detector.ts           # CommentDetector - web-tree-sitter based comment detection
├── filters/
│   ├── index.ts          # Filter barrel export
│   ├── bdd.ts            # BDD pattern filter
│   ├── directive.ts      # Linter/typechecker directive filter
│   ├── docstring.ts      # Docstring filter
│   └── shebang.ts        # Shebang filter
├── output/
│   ├── index.ts          # Output barrel export
│   ├── formatter.ts      # FormatHookMessage
│   └── xml-builder.ts    # BuildCommentsXML
└── utils.ts              # Utility functions
```

### 1.3 Data Flow

```
[write/edit tool execution]
       │
       ▼
┌──────────────────────┐
│ tool.execute.before  │
│  - Capture file path │
│  - Store in          │
│    pendingCalls Map  │
└──────────┬───────────┘
           │
           ▼
    [Actual tool execution]
           │
           ▼
┌──────────────────────┐
│ tool.execute.after   │
│  - Lookup data from  │
│    pendingCalls      │
│  - Read file         │
│  - Detect comments   │
│  - Apply filters     │
│  - Inject message    │
└──────────────────────┘
```

---

## 2. Implementation Order

### Phase 1: Foundation
1. Create `src/hooks/comment-checker/` directory
2. `types.ts` - All type definitions
3. `constants.ts` - Language registry, directive patterns

### Phase 2: Filter Implementation
4. `filters/bdd.ts` - BDD pattern filter
5. `filters/directive.ts` - Directive filter
6. `filters/docstring.ts` - Docstring filter
7. `filters/shebang.ts` - Shebang filter
8. `filters/index.ts` - Filter composition

### Phase 3: Core Logic
9. `detector.ts` - web-tree-sitter based comment detection
10. `output/xml-builder.ts` - XML output
11. `output/formatter.ts` - Message formatting

### Phase 4: Hook Integration
12. `index.ts` - Hook factory and state management
13. Update `src/hooks/index.ts` - Add exports

### Phase 5: Dependencies and Build
14. Update `package.json` - Add web-tree-sitter
15. Verify typecheck and build

---

## 3. Key Implementation Details

### 3.1 Language Registry (38 languages)

```typescript
const LANGUAGE_REGISTRY: Record<string, LanguageConfig> = {
  python: { extensions: [".py"], commentQuery: "(comment) @comment", docstringQuery: "..." },
  javascript: { extensions: [".js", ".jsx"], commentQuery: "(comment) @comment" },
  typescript: { extensions: [".ts"], commentQuery: "(comment) @comment" },
  tsx: { extensions: [".tsx"], commentQuery: "(comment) @comment" },
  go: { extensions: [".go"], commentQuery: "(comment) @comment" },
  rust: { extensions: [".rs"], commentQuery: "(line_comment) @comment (block_comment) @comment" },
  // ... all 38 languages
}
```

### 3.2 Filter Logic

**BDD Filter**: `given, when, then, arrange, act, assert`
**Directive Filter**: `noqa, pyright:, eslint-disable, @ts-ignore` etc. 30+
**Docstring Filter**: `IsDocstring || starts with /**`
**Shebang Filter**: `starts with #!`

### 3.3 Output Format (100% identical to Go version)

```
COMMENT/DOCSTRING DETECTED - IMMEDIATE ACTION REQUIRED

Your recent changes contain comments or docstrings, which triggered this hook.
You need to take immediate action. You must follow the conditions below.
(Listed in priority order - you must always act according to this priority order)

CRITICAL WARNING: This hook message MUST NEVER be ignored...

<comments file="/path/to/file.py">
	<comment line-number="10">// comment text</comment>
</comments>
```

---

## 4. Files to Create

1. `src/hooks/comment-checker/types.ts`
2. `src/hooks/comment-checker/constants.ts`
3. `src/hooks/comment-checker/filters/bdd.ts`
4. `src/hooks/comment-checker/filters/directive.ts`
5. `src/hooks/comment-checker/filters/docstring.ts`
6. `src/hooks/comment-checker/filters/shebang.ts`
7. `src/hooks/comment-checker/filters/index.ts`
8. `src/hooks/comment-checker/output/xml-builder.ts`
9. `src/hooks/comment-checker/output/formatter.ts`
10. `src/hooks/comment-checker/output/index.ts`
11. `src/hooks/comment-checker/detector.ts`
12. `src/hooks/comment-checker/index.ts`

## 5. Files to Modify

1. `src/hooks/index.ts` - Add exports
2. `package.json` - web-tree-sitter dependency

---

## 6. Definition of Done

- [ ] Comment detection works on write/edit tool execution
- [ ] All 4 filters working properly
- [ ] At least 5 languages supported (Python, JS, TS, TSX, Go)
- [ ] Output format identical to Go version
- [ ] Typecheck passes
- [ ] Build succeeds
