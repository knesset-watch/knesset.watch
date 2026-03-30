# Open Knesset Modernization Research & Plan

## 1. Vision
Revive the Open Knesset project by shifting focus from static legislative tracking to **Active Transparency**. The goal is to show what MKs are *actually doing* (meetings, connections, networks) rather than just what they say or vote.

## 2. Key Features (The "MK 360" View)

### A. Activity Timeline
- **Real-time Calendar**: Pull from `KNS_Agenda` (OData) to show upcoming and past meetings.
- **Participation Feed**: Automated logs of committee appearances and plenum speeches.

### B. Network of Connections (The "Influence Map")
- **Relationship Graph**: Nodes representing MKs, Lobbyists, and Organizations.
- **Edge Types**: 
    - *Formal*: Committee memberships, bill co-sponsorship.
    - *Informal*: Frequent meetings (derived from agenda logs), shared lobbyists.
- **Technology**: Use `React-Force-Graph` or `Cytoscape.js` for web-based interactive exploration.

### C. Transparency Metrics
- **Presence vs. Impact**: Compare time spent in the Knesset vs. legislative output.
- **Stakeholder Access**: Tracking which organizations or lobbyists meet most frequently with specific committees or MKs.

## 3. Data Strategy

### OData Entities to Leverage
- `KNS_Person`: Primary MK identity.
- `KNS_Agenda`: The source for the "Actual Activities".
- `KNS_DocumentMK`: Linking documents and protocols to specific members.
- `KNS_Committee`: Mapping the formal networks.

### Integration Plan
1. **Bridge Legacy Data**: Map existing `Member` IDs in the Django DB to OData `PersonID`.
2. **Sync Engine**: A background task to pull OData updates into a modern searchable schema (likely using the new Next.js API routes).
3. **Graph Database (Optional)**: Consider using a graph-ready structure (like JSON-LD or a dedicated Neo4j instance) if the network complexity grows.

## 4. Best Practices for Transparency
- **Mobile-First**: Most citizens consume this on the go.
- **Avoid "Hairballs"**: Use intelligent filtering (e.g., "Show connections for MK X only") to keep graphs readable.
- **Proactive Disclosure**: Don't just wait for the protocol to be published; show the *scheduled* activity.

## 5. Implementation Roadmap
1. **Phase 1: Discovery** (Complete) - Analyzed legacy models and OData capabilities.
2. **Phase 2: MK Dashboard Prototype** - Build a single MK page in `Open Knesset 26` that pulls real-time OData activities.
3. **Phase 3: Connection Graph** - Implement a "Network" tab using co-sponsorship and committee data as a starting point.
4. **Phase 4: Data Bridge** - Create the sync script to unify legacy voting records with new activity data.
