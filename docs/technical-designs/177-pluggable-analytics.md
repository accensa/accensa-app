# Issue #177: Pluggable Analytics Architecture with Custom Dimensions

## Overview

Transform the hardcoded analytics dashboard into a flexible, configuration-driven system using Cube.js as a semantic layer. Merchants can define custom dimensions, metrics, and dashboard layouts via JSON configuration without code changes.

## Problem

Current state (`apps/web/src/lib/revenue-analytics.ts`):
- Analytics logic hardcoded in TypeScript (`buildRouteBreakdown`, `buildRevenueSeries`)
- Direct PostgreSQL queries with no abstraction layer
- Every merchant gets identical dashboard
- Adding new dimensions requires code changes and deployment
- No support for custom aggregations or complex metrics

## Solution Architecture

### 1. Cube.js Semantic Layer

**Deployment**: Run Cube.js as a separate service (Railway/Fly.io)
- Cannot run in Vercel (requires persistent process for query caching)
- Connects to PostgreSQL (Supabase) for data access
- Exposes REST API for dashboard queries

**Data Model** (`cube.js` files):
```javascript
// payments.js
cube(`Payments`, {
  sql: `SELECT * FROM payments WHERE ts IS NOT NULL`,
  
  dimensions: {
    txHash: { sql: `tx_hash`, type: `string`, primaryKey: true },
    route: { sql: `route`, type: `string` },
    method: { sql: `method`, type: `string` },
    payer: { sql: `payer`, type: `string` },
    asset: { sql: `asset`, type: `string` },
    timestamp: { sql: `ts`, type: `time` }
  },
  
  measures: {
    count: { type: `count` },
    totalAmount: { sql: `amount`, type: `sum` },
    avgAmount: { sql: `amount`, type: `avg` },
    uniquePayers: { sql: `payer`, type: `countDistinct` }
  },
  
  preAggregations: {
    dailyRevenue: {
      dimensions: [CUBE.timestamp],
      measures: [CUBE.totalAmount, CUBE.count],
      timeDimension: CUBE.timestamp,
      granularity: `day`,
      refreshKey: { every: `5 minute` }
    }
  }
});
```

**Why Cube.js**:
- Built-in caching and pre-aggregations (10-100x query speedup)
- Multi-tenant support (filter by merchant ID for SaaS)
- REST and GraphQL APIs out of the box
- SQL generation from declarative queries
- Works with existing PostgreSQL schema

### 2. Dynamic Query Builder UI

**Location**: `apps/web/src/components/analytics/QueryBuilder.tsx`

**Features**:
- Drag-and-drop interface for dimensions and measures
- Date range picker
- Filter builder (route contains "checkout", amount > 100)
- Visualization type selector (bar, line, pie, table)
- Save queries as named widgets

**Example Query**:
```json
{
  "measures": ["Payments.totalAmount", "Payments.count"],
  "dimensions": ["Payments.route", "Payments.method"],
  "timeDimensions": [{
    "dimension": "Payments.timestamp",
    "dateRange": ["2026-07-01", "2026-08-01"],
    "granularity": "day"
  }],
  "filters": [{
    "member": "Payments.asset",
    "operator": "equals",
    "values": ["native"]
  }]
}
```

**UI Libraries**:
- `@cubejs-client/react` for Cube.js integration
- `recharts` for visualizations (already used in dashboard)
- `react-dnd` for drag-and-drop

### 3. Pluggable Widget Architecture

**Configuration Storage**: PostgreSQL table `dashboard_configs`
```sql
CREATE TABLE dashboard_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_address VARCHAR(56) NOT NULL,
  layout JSONB NOT NULL, -- Grid layout positions
  widgets JSONB NOT NULL, -- Widget queries and settings
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

**Widget Config Example**:
```json
{
  "id": "revenue-by-route",
  "type": "bar",
  "title": "Revenue by Route (Last 30 Days)",
  "query": {
    "measures": ["Payments.totalAmount"],
    "dimensions": ["Payments.route"],
    "timeDimensions": [{
      "dimension": "Payments.timestamp",
      "dateRange": "last 30 days"
    }]
  },
  "position": { "x": 0, "y": 0, "w": 6, "h": 4 }
}
```

**Layout Manager**: `react-grid-layout` for drag-and-drop dashboard customization

### 4. Backward Compatibility

Preserve existing analytics views:
- `/dashboard/analytics` continues working with default widgets
- `revenue-analytics.ts` functions remain for any direct consumers
- Migrate existing hardcoded views to Cube.js queries progressively
- Add feature flag: `ENABLE_CUSTOM_ANALYTICS` (default: false)

## Implementation Plan

### Phase 1: Infrastructure (Week 1)
- [ ] Deploy Cube.js to Railway
- [ ] Define `Payments` cube data model
- [ ] Add `dashboard_configs` table to PostgreSQL
- [ ] Test Cube.js REST API from Vercel

### Phase 2: Query Builder UI (Week 2)
- [ ] Create `QueryBuilder` component
- [ ] Integrate `@cubejs-client/react`
- [ ] Build dimension/measure selector
- [ ] Build filter UI
- [ ] Add visualization renderer

### Phase 3: Widget System (Week 3)
- [ ] Create widget container component
- [ ] Integrate `react-grid-layout`
- [ ] Build widget editor modal
- [ ] Implement save/load dashboard configs
- [ ] Add default dashboard templates

### Phase 4: Migration (Week 4)
- [ ] Rewrite `buildRouteBreakdown` as Cube.js query
- [ ] Rewrite `buildRevenueSeries` as Cube.js query
- [ ] Add feature flag toggle in settings
- [ ] Comprehensive testing and bug fixes

## Performance Considerations

- **Pre-aggregations**: Cube.js builds rollup tables (daily, weekly, monthly)
- **Caching**: In-memory cache for frequent queries (TTL: 5 minutes)
- **Query optimization**: Cube.js generates optimized SQL with indexes
- **Expected latency**: 50-200ms for pre-aggregated queries vs. 500ms+ for raw SQL

## Cost Estimate

- **Railway Cube.js instance**: $5-15/month (512MB RAM, 0.5 CPU sufficient)
- **PostgreSQL storage**: Minimal increase (<100MB for pre-aggregations)
- **Development time**: 4 weeks (1 engineer)

## Success Metrics

- [ ] Merchants can create custom dashboard in <5 minutes
- [ ] Query latency <200ms p99 for pre-aggregated data
- [ ] 100% of existing analytics views work via Cube.js
- [ ] Zero breaking changes to public API routes

## References

- Cube.js Docs: https://cube.dev/docs
- Example Dashboard: https://cube.dev/blog/react-dashboard-with-cube-js
- Multi-tenancy: https://cube.dev/docs/multitenancy
