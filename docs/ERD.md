# Database ERD

All enums are stored as strings for SQLite portability; canonical value sets
live in `src/lib/enums.ts`. Soft deletes via `deletedAt` on `User`, `Employee`,
`Site`.

```mermaid
erDiagram
  User ||--o| Employee : "links"
  User ||--o{ Session : has
  User ||--o{ AuditLog : actor
  User ||--o{ Notification : receives
  User ||--o{ Approval : "acts on"

  Employee ||--o{ Employee : "manages (reports)"
  Employee ||--o{ SiteVisit : punches
  Employee ||--o{ Journey : travels
  Employee ||--o{ Claim : files

  Site ||--o{ SiteVisit : "visited at"
  Site ||--o{ Journey : "from / to"

  SiteVisit ||--o| Journey : "arrival leg"

  Claim ||--o{ ClaimItem : contains
  Claim ||--o{ Approval : "audited by"
  Journey ||--o| ClaimItem : "billed as"

  DistanceCache

  User {
    string id PK
    string email UK
    string passwordHash
    string role  "SUPER_ADMIN|ADMIN|MANAGER|EMPLOYEE"
    bool   isActive
  }
  Employee {
    string id PK
    string employeeCode UK
    string department
    string designation
    string vehicleType
    string managerId FK
    string userId FK,UK
  }
  Site {
    string id PK
    string code UK
    float  latitude
    float  longitude
    int    geofenceRadius
    bool   isOffice
  }
  SiteVisit {
    string id PK
    string workDate
    datetime checkInAt
    datetime checkOutAt
    float  inDistance
    string status "OPEN|CLOSED"
  }
  Journey {
    string id PK
    int    sequence
    float  distanceKm
    float  haversineKm
    string source "GOOGLE|HAVERSINE|CACHE"
    float  amount
  }
  Claim {
    string id PK
    string periodMonth
    float  totalKm
    float  totalAmount
    string status
  }
}
```

## Indexes & constraints (highlights)

- `User.email` unique; `Employee.employeeCode` unique; `Site.code` unique.
- `Claim` unique on `(employeeId, periodMonth)` — one claim per person per month.
- `ClaimItem.journeyId` unique — a leg can be billed once.
- `Journey.arrivalVisitId` unique — one arrival leg per visit.
- `DistanceCache.key` unique (`"lat,lng|lat,lng"` at 5 dp) — routes never billed twice.
- Composite indexes on `SiteVisit(employeeId, workDate)` and
  `Journey(employeeId, workDate)` for fast daily/monthly rollups.
