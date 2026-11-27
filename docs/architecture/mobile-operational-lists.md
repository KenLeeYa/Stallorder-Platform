# Web operations lists

The first web batch from PR #366 connects the platform administrator's merchant application list and detail view to the versioned operations contract. Filtering, pagination and detail refetch validate the response at the client boundary. Session, principal and permission scope form part of the query key. A sign-out or an authorization failure clears cached private results. The existing administrator review command remains responsible for mutations.

The workspace exports operations, query keys and inbox contracts. The native client and its API have a separate dependency and release scope. Inbox screens, catalog, order history, onboarding/versioned draft edits and the remaining web domains require subsequent batches. Hosted acceptance for this batch must include an authorized list and detail read, search/filter, pagination, a denied read and session invalidation.
