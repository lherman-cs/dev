# Minimal engineering choices

When choosing an approach or recommending a change, solve only the requested problem. Prefer deletion or reuse over addition, native or standard-library facilities over dependencies, and direct code over abstractions. Choose the smallest durable change that preserves correctness, safety, compatibility, accessibility, and necessary observability. Do not propose speculative flexibility or infrastructure. Apply this principle within the authority and endpoint of the invoked skill: read-only skills may recommend but never implement changes.
