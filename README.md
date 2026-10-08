# Node.js MCP Server for Gallica/BnF

A high-quality TypeScript/Node.js MCP (Model Context Protocol) server for accessing the Gallica digital library of the Bibliothèque nationale de France (BnF). This server faithfully reproduces all functionality from the [Python MCP server](https://github.com/Kryzo/mcp-bibliotheque_nationale_de_France) and extends it with additional features for IIIF images, OCR text, and item metadata.

## Features

### Core Search Tools (8 tools - matching Python)
- **search_by_title** - Search documents by title with exact match option
- **search_by_author** - Search documents by author with exact match option
- **search_by_subject** - Search documents by subject with exact match option
- **search_by_date** - Search documents by date (YYYY, YYYY-MM, or YYYY-MM-DD)
- **search_by_document_type** - Search by document type (monographie, periodique, image, etc.)
- **advanced_search** - Custom CQL query syntax for complex searches
- **natural_language_search** - Natural language search across all fields
- **sequential_reporting** - Multi-step sequential report generation with source management

### Extended Tools (4 new tools)
- **get_item_details** - Get full metadata for an item by ARK identifier
- **get_item_pages** - Enumerate pages of a document with IIIF URLs
- **get_page_image** - Generate IIIF image URLs for specific pages
- **get_page_text** - Retrieve OCR/text content (ALTO, plain text)

## Installation

### Prerequisites
- Node.js 18.0 or higher
- npm or yarn

### Steps

1. **Clone or download this repository**

2. **Install dependencies:**
   ```bash
   cd node-mcp-bnf
   npm install
   ```

3. **Build the project:**
   ```bash
   npm run build
   ```

## Usage

### Local Development

#### Option 1: HTTP Server (Recommended for Development)

Run the server on a local HTTP port for testing:

```bash
npm run dev:http
```

This starts the server on `http://localhost:3000` (or the port specified in `PORT` environment variable).

The server will:
- Listen on the specified port
- Accept MCP requests via HTTP/SSE
- Log all activity to the console

You can test it by connecting an MCP client to `http://localhost:3000/message`.

#### Option 2: STDIO Mode (For MCP Clients)

The server can be used locally with Claude Desktop or Cursor MCP via STDIO.

**Run in STDIO mode:**
```bash
npm run dev
```

#### Claude Desktop Configuration

Add to your Claude Desktop configuration file (usually `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "gallica-bnf": {
      "command": "node",
      "args": ["/path/to/node-mcp-bnf/dist/index.js"],
      "cwd": "/path/to/node-mcp-bnf"
    }
  }
}
```

#### Cursor MCP Configuration

Add to your Cursor MCP settings:

```json
{
  "mcpServers": {
    "gallica-bnf": {
      "command": "node",
      "args": ["/path/to/node-mcp-bnf/dist/index.js"]
    }
  }
}
```

### Development Scripts

- `npm run dev` - Run in STDIO mode (for MCP clients like Cursor/Claude Desktop)
- `npm run dev:http` - Run HTTP server on local port (default: 3000)
- `npm start` - Run compiled STDIO version
- `npm run start:http` - Run compiled HTTP server version

**Environment Variables for HTTP Server:**
- `PORT` - Port to listen on (default: 3000)
- `LOG_LEVEL` - Logging level (error, warn, info, debug)

## Deployment on Vercel

### Prerequisites
- Vercel account
- Vercel CLI installed (`npm i -g vercel`)

### Steps

1. **Create `vercel.json` in project root:**
   ```json
   {
     "functions": {
       "src/httpServer.ts": {
         "runtime": "nodejs18.x"
       }
     },
     "routes": [
       {
         "src": "/(.*)",
         "dest": "src/httpServer.ts"
       }
     ]
   }
   ```

2. **Set environment variables in Vercel dashboard:**
   - `GALLICA_BASE_URL` (optional, default: `https://gallica.bnf.fr`)
   - `GALLICA_SRU_URL` (optional, default: `https://gallica.bnf.fr/SRU`)
   - `LOG_LEVEL` (optional, default: `info`)
   - `MCP_ICON_URL` (optional, absolute URL to icon - defaults to `/icon.svg` relative to server URL)

3. **Deploy:**
   ```bash
   vercel deploy
   ```

4. **Configure Cursor/Claude Desktop to use HTTP endpoint:**
   ```json
   {
     "mcpServers": {
       "gallica-bnf": {
         "url": "https://your-vercel-app.vercel.app"
       }
     }
   }
   ```

## API Documentation

### Search Tools

#### search_by_title
Search for documents by title.

**Parameters:**
- `title` (string, required): The title to search for
- `exact_match` (boolean, optional): If true, search for exact title
- `max_results` (number, optional, default: 10): Maximum results (1-50)
- `start_record` (number, optional, default: 1): Starting record for pagination

**Example:**
```json
{
  "title": "Les Misérables",
  "exact_match": false,
  "max_results": 10
}
```

#### search_by_author
Search for documents by author.

**Parameters:**
- `author` (string, required): The author name
- `exact_match` (boolean, optional): If true, search for exact author name
- `max_results` (number, optional, default: 10)
- `start_record` (number, optional, default: 1)

#### search_by_subject
Search for documents by subject/keywords.

**Parameters:**
- `subject` (string, required): The subject to search for
- `exact_match` (boolean, optional)
- `max_results` (number, optional, default: 10)
- `start_record` (number, optional, default: 1)

#### search_by_date
Search for documents by publication date.

**Parameters:**
- `date` (string, required): Date in format YYYY, YYYY-MM, or YYYY-MM-DD
- `max_results` (number, optional, default: 10)
- `start_record` (number, optional, default: 1)

**Example:**
```json
{
  "date": "1862",
  "max_results": 20
}
```

#### search_by_document_type
Search for documents by type.

**Parameters:**
- `doc_type` (string, required): Document type (monographie, periodique, image, manuscrit, carte, musique, etc.)
- `max_results` (number, optional, default: 10)
- `start_record` (number, optional, default: 1)

#### advanced_search
Perform advanced search with custom CQL query.

**Parameters:**
- `query` (string, required): CQL query string
- `max_results` (number, optional, default: 10)
- `start_record` (number, optional, default: 1)

**Example:**
```json
{
  "query": "dc.creator all \"Victor Hugo\" and dc.type all \"monographie\""
}
```

#### natural_language_search
Natural language search across all fields.

**Parameters:**
- `query` (string, required): Natural language search query
- `max_results` (number, optional, default: 10)
- `start_record` (number, optional, default: 1)

### Extended Tools

#### get_item_details
Get full metadata for an item.

**Parameters:**
- `ark` (string, required): ARK identifier (e.g., "ark:/12148/bpt6k123456" or "bpt6k123456")

**Returns:**
- Bibliographic data (title, creator, date, etc.)
- Available formats (iiif, image, text, alto)
- IIIF manifest URL
- Gallica URL

#### get_item_pages
Enumerate pages of a document.

**Parameters:**
- `ark` (string, required): ARK identifier
- `page` (number, optional): Get specific page number
- `page_size` (number, optional): Get first N pages
- `page_range` (array, optional): Get pages in range [start, end]

**Returns:**
- Array of page info with:
  - Page number
  - Label
  - IIIF image URL
  - Text availability flag
  - Thumbnail URL

#### get_page_image
Get IIIF image URL for a specific page.

**Parameters:**
- `ark` (string, required): ARK identifier
- `page` (number, required): Page number
- `size` (string, optional): Image size (e.g., "full", "200,", "500,500")
- `region` (string, optional): Image region (e.g., "full", "x,y,w,h")

**Returns:**
- IIIF image URL
- Thumbnail URL

#### get_page_text
Retrieve OCR/text content for a page.

**Parameters:**
- `ark` (string, required): ARK identifier
- `page` (number, required): Page number
- `format` (string, optional): "plain" (default) or "alto" — both return plain text extracted from the page's ALTO OCR. "tei" is not available per page. Gallica's `.texteBrut` endpoint is not used: it redirects automated clients to an anti-bot challenge.

**Returns:**
- Text content (or null if not available)
- Availability flag

### Sequential Reporting Tool

#### sequential_reporting
Generate research reports in a sequential, step-by-step manner.

**Workflow:**

1. **Initialize:**
   ```json
   {
     "topic": "Impressionnisme en France",
     "page_count": 4,
     "source_count": 10,
     "include_graphics": true
   }
   ```

2. **Search sources:**
   ```json
   {
     "search_sources": true
   }
   ```

3. **Create bibliography:**
   ```json
   {
     "section_number": 1,
     "total_sections": 8,
     "title": "Bibliography",
     "content": "...",
     "is_bibliography": true,
     "sources_used": [1, 2, 3],
     "next_section_needed": true
   }
   ```

4. **Write sections sequentially:**
   ```json
   {
     "section_number": 2,
     "total_sections": 8,
     "title": "Introduction",
     "content": "...",
     "sources_used": [1, 2],
     "next_section_needed": true
   }
   ```

5. **Complete report:**
   ```json
   {
     "section_number": 8,
     "total_sections": 8,
     "title": "Conclusion",
     "content": "...",
     "sources_used": [5, 6],
     "next_section_needed": false
   }
   ```

## Configuration

### Environment Variables

- `GALLICA_BASE_URL` - Base URL for Gallica API (default: `https://gallica.bnf.fr`)
- `GALLICA_SRU_URL` - SRU search endpoint (default: `https://gallica.bnf.fr/SRU`)
- `LOG_LEVEL` - Logging level: `error`, `warn`, `info`, `debug` (default: `info`)
- `HTTP_TIMEOUT` - Timeout per HTTP attempt in milliseconds (default: 45000)
- `HTTP_RETRIES` - Retries for transient failures only: network errors, 429, 502-504 (default: 1)
- `HTTP_DEADLINE` - Total time budget per Gallica call, including queueing and retries, in ms (default: 55000)
- `GALLICA_MIN_INTERVAL_MS` - Minimum spacing between requests to Gallica; requests are sent one at a time (default: 1000)
- `GALLICA_CACHE_TTL_MS` - How long successful Gallica responses are cached in memory (default: 600000)

> Gallica blocks IP addresses that send bursts of requests (first TCP resets, then
> `403 Access Denied`). Keep the request interval at 1s or more, especially on shared
> hosting such as Vercel. Throttling and caching are per server instance.
- `DEFAULT_MAX_RECORDS` - Default maximum search results (default: 10)
- `DEFAULT_START_RECORD` - Default starting record for pagination (default: 1)

## Development

### Project Structure

```
node-mcp-bnf/
├── src/
│   ├── index.ts              # STDIO entry point
│   ├── httpServer.ts        # HTTP entry point
│   ├── mcpServer.ts         # MCP server setup
│   ├── config.ts            # Configuration
│   ├── logging.ts           # Logging utility
│   ├── tools/               # MCP tools
│   └── gallica/             # Gallica API clients
├── docs/                     # Documentation
├── tests/                    # Unit tests
└── package.json
```

### Building

```bash
npm run build
```

### Testing

```bash
npm test
```

### Development Mode

```bash
npm run dev
```

## Documentation

- [Python Architecture Analysis](docs/ARCHITECTURE-python.md) - Analysis of the original Python server
- [Gallica API Notes](docs/GALLICA-API-NOTES.md) - Detailed API documentation
- [Node.js Architecture](docs/ARCHITECTURE-node.md) - Architecture and design of this server

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Acknowledgments

- Based on the Python MCP server by [Kryzo](https://github.com/Kryzo/mcp-bibliotheque_nationale_de_France)
- Uses the [Model Context Protocol](https://modelcontextprotocol.io/) SDK
- Built for the [Gallica digital library](https://gallica.bnf.fr/) of the Bibliothèque nationale de France

