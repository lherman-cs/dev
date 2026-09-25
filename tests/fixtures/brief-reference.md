# Branch consequence brief

```brief-lead
{"title":"Bottom line","body":"Illustrative reference sample, not a live assessment. The pictured change moves latency policy outside a SCReAM-like core and tightens feedback accounting: confirmed gaps do not immediately become loss, and packet timing carries clock-confidence metadata. Controller and egress behavior remain uncertain where the sample omits their diffs.","anchors":["src/scream.rs:1","src/rtp.rs:1"],"aside":{"label":"Evidence incomplete","text":"Controller and egress behavior are omitted from this sample. No claim about their implementation or measured effects is supported."}}
```

## What changed

```brief-section
{"id":"s-what-changed","kind":"overview","anchors":[],"blocks":[{"type":"flow","label":"At a glance · illustrated changes","steps":["Latency policy moved to an external controller","Feedback gaps handled without immediate loss","Clock confidence added across packet transit","Controller and egress diffs omitted; impact unknown"],"anchors":["src/scream.rs:1","src/rtp.rs:1"]}]}
```

## System map

```brief-section
{"id":"s-system-map","kind":"overview","anchors":["docs/architecture.md:1"],"blocks":[{"type":"columns","label":"Architecture at a glance","columns":[[{"type":"diagram","label":"Packet and feedback path","mermaid":"flowchart LR\n  A[Sender / egress] -->|RTP packets and timing| B[Network]\n  B -->|delivery or loss| C[Receiver / egress]\n  C -->|ACK or loss feedback| A","takeaway":"Packets travel outward through the network; receiver feedback returns with ACK, loss and confidence state. This does not prove egress behavior."}],[{"type":"list","label":"Key takeaways","items":["Latency policy is external.","Feedback carries richer state.","Clock confidence survives transit.","Egress behavior is unknown."],"anchors":["src/scream.rs:1","src/rtp.rs:1"]}]],"widths":[3,1]}]}
```

## Change inventory

```brief-section
{"id":"s-change-inventory","anchors":["src/scream.rs:1","src/rtp.rs:1"],"blocks":[{"type":"table","label":"Illustrative components in the sample; not measured repository totals","columns":["Module / component","Captured file","Purpose / confidence"],"rows":[["SCReAM-like core","src/scream.rs","Policy removal and gap-accounting illustration"],["Packet transport","src/rtp.rs","Clock-confidence metadata illustration"],["Controller / egress","Not in fixture","Unknown; do not infer behavior"]]}]}
```

## Latency policy is now external to the core

```brief-section
{"id":"s-latency-policy","anchors":["src/scream.rs:1"],"blocks":[{"type":"text","label":"Why it matters","text":"The illustrative core delegates admission and pacing decisions to a separate controller. The core can focus on congestion accounting; this does not establish that a real deployment changed policy."},{"type":"columns","label":"Architecture, behavior and ownership","columns":[[{"type":"comparison","label":"Architecture delta","before":"Inside core: admission, queue policy, retransmission and rate choices.","after":"External controller: latency policy. Core: congestion accounting only."}],[{"type":"code","label":"Pseudocode comparison · illustrative, not implemented","language":"text","status":"pseudocode","text":"BEFORE  if queue_delay > target:\n          cut_rate()\nAFTER   on_event(packet):\n          controller.decide()\n          core.update_accounting()"}],[{"type":"list","label":"Ownership / key changes","items":["Policy moves out of the core.","The core keeps congestion accounting.","A separate controller can evolve independently."]}]],"widths":[3,4,2]}]}
```

## Feedback gaps no longer immediately become loss

```brief-section
{"id":"s-feedback-gaps","anchors":["src/scream.rs:2"],"blocks":[{"type":"text","label":"Why it matters","text":"In this illustration, a missing report can remain provisional until a later receipt or deadline. Do not read a gap as confirmed loss without the second condition."},{"type":"columns","label":"Gap and deadline models","columns":[[{"type":"flow","label":"Packet lifecycle · illustrative","steps":["Packet sent","Gap detected","Wait for more evidence","ACK or loss after deadline"]}],[{"type":"diagram","label":"State machine · implied","mermaid":"stateDiagram-v2\n  [*] --> Received\n  Received --> GapDetected: missing report\n  GapDetected --> Wait: provisional\n  Wait --> Received: later ACK\n  Wait --> Loss: deadline","takeaway":"A provisional gap can return to received on later ACK; loss follows the deadline only if the gap persists."}],[{"type":"code","label":"Pseudocode comparison · illustrative","language":"text","status":"pseudocode","text":"BEFORE  if gap: reduce_rate()\nAFTER   if gap: wait_for_report()\n        if deadline_passed(): confirm_loss()"}]]},{"type":"callout","label":"Implication, not measurement","tone":"note","text":"This example suggests fewer premature loss signals. No measured rate or runtime result is supplied.","anchors":[]}]}
```

## Clock confidence survives packet transit

```brief-section
{"id":"s-clock-confidence","anchors":["src/rtp.rs:1"],"blocks":[{"type":"text","label":"Why it matters","text":"Illustrative packet timing can be synchronized, provisional, unverified or discontinuous. A receiver can preserve that distinction rather than treating every timestamp as equally trustworthy."},{"type":"columns","label":"Packet metadata and handling","columns":[[{"type":"table","label":"Packet data shape · illustrative","columns":["Field","Size","Meaning"],"rows":[["rtp_timestamp","32 bits","Packet timestamp"],["clock_confidence","2 bits","Clock quality state"],["timing_extension","16 bits","Uncertainty or version"]]}],[{"type":"list","label":"Confidence states","items":["Synchronized: source clock aligned.","Provisional: temporary confidence.","Unverified: no validation available.","Discontinuous: a clock jump or reset."]}],[{"type":"flow","label":"End-to-end propagation","steps":["Ingress tags confidence","Network preserves fields","Egress interprets uncertainty"]}]]}]}
```

## Data structures and protocol changes

```brief-section
{"id":"s-data-structures","anchors":["src/rtp.rs:1","src/scream.rs:1"],"blocks":[{"type":"columns","label":"Illustrative schema and message format","columns":[[{"type":"list","label":"Key changes","items":["Add clock-confidence metadata to packet timing.","Separate provisional feedback from confirmed loss.","Retain compatibility handling for absent fields."],"anchors":["src/rtp.rs:1"]}],[{"type":"code","label":"Example schema · pseudocode","language":"rust","status":"pseudocode","text":"struct PacketTiming {\n    timestamp: u32,\n    confidence: ClockState,\n    uncertainty: Option<u16>,\n}","anchors":["src/rtp.rs:1"]}],[{"type":"comparison","label":"Message format","before":"RTP header plus ordinary payload.","after":"RTP header plus optional confidence extension and payload.","anchors":["src/rtp.rs:1"]}]],"anchors":["src/rtp.rs:1"]}]}
```

## Call flow (end-to-end)

```brief-section
{"id":"s-call-flow","anchors":["docs/architecture.md:1"],"blocks":[{"type":"flow","label":"Illustrative path","steps":["Capture packet with timestamp","Tag clock confidence","Send over network","Receive and process feedback","Update rate and state"]},{"type":"list","label":"Notes","items":["Feedback and delivery are separate events.","Clock confidence is preserved end-to-end in the pictured design.","External controller handles admission policy."]}]}
```

## Configuration

```brief-section
{"id":"s-configuration","anchors":["src/scream.rs:1"],"blocks":[{"type":"columns","label":"Settings and example","columns":[[{"type":"table","label":"New / changed settings · illustrative","columns":["Setting","Default","Description"],"rows":[["controller_enabled","true","Enable external controller"],["timing_reserve_ms","50","Uncertainty reserve"],["reorder_deadline_ms","200","Time before confirming loss"],["clock_confidence","required","Require confidence metadata"]]}],[{"type":"code","label":"Configuration example · illustrative","language":"toml","status":"pseudocode","text":"[core]\ncontroller_enabled = true\ntiming_reserve_ms = 50\nreorder_deadline_ms = 200\nclock_confidence = 'required'"}]]}]}
```

## Invariants

```brief-section
{"id":"s-invariants","anchors":["src/scream.rs:1"],"blocks":[{"type":"columns","label":"What the pictured design maintains and excludes","columns":[[{"type":"list","label":"Must · design intent","items":["Preserve packet integrity.","Maintain ordering properties.","Honor clock confidence.","Fail safely on missing data."]}],[{"type":"callout","label":"Must not · design intent","tone":"warning","text":"Do not treat a gap as immediate loss; do not infer precise timing from unverified clock data; do not silently break older feedback formats."}]]}]}
```

## Behavior scenarios

```brief-section
{"id":"s-scenarios","anchors":["src/scream.rs:2","src/rtp.rs:1"],"blocks":[{"type":"columns","label":"Illustrative cases, not test results","columns":[[{"type":"list","label":"A · Normal operation","items":["Synchronized clock.","Packets live in order.","ACKs received on time."],"anchors":["src/rtp.rs:1"]}],[{"type":"list","label":"B · Reordered packets","items":["Gap detected.","Wait for reordering deadline.","Late packets may fill gaps."],"anchors":["src/scream.rs:2"]}],[{"type":"list","label":"C · Uncertain timing","items":["Provisional or unverified clock.","Use a larger admission reserve.","Avoid consecutive sending."],"anchors":["src/rtp.rs:1"]}],[{"type":"list","label":"D · Missing feedback","items":["No feedback for a period.","Use a larger reserve.","Avoid false loss signals."],"anchors":["src/scream.rs:2"]}]],"anchors":[]}]}
```

## Validation

```brief-section
{"id":"s-validation","anchors":[],"blocks":[{"type":"table","label":"Reference illustration only · no checks executed for this sample","columns":["Scenario","Status","Coverage boundary"],"rows":[["ACK credit advancement","Not run","Would require a unit test"],["Gap handling / reordering","Not run","Would require integration coverage"],["Clock confidence propagation","Not run","Would require packet-level tests"],["End-to-end with controller","Not run","Would require deployment validation"]]}]}
```

## Compatibility matrix

```brief-section
{"id":"s-compatibility","anchors":[],"blocks":[{"type":"table","label":"Illustrative expectations · unverified","columns":["Client / server","Old peer","New peer","Mixed peers"],"rows":[["Old","Unknown","Unknown","Unknown"],["New","Unknown","Unknown","Unknown"],["Mixed","Unknown","Unknown","Unknown"]]},{"type":"callout","label":"Boundary","tone":"unknown","text":"The pictured matrix is a design prompt, not observed compatibility. No interoperability run is represented here."}]}
```

## Performance / operational impact

```brief-section
{"id":"s-performance-impact","anchors":[],"blocks":[{"type":"table","label":"Potential impacts, not measured effects","columns":["Metric","Direction","Reason to investigate"],"rows":[["End-to-end latency","Unknown","Controller path adds a policy boundary"],["CPU usage","Unknown","Additional metadata and state"],["Network overhead","Unknown","Clock confidence extension"],["Operational complexity","Unknown","Separate controller lifecycle"]]}]}
```

## Failure modes

```brief-section
{"id":"s-failure-modes","anchors":["src/scream.rs:2"],"blocks":[{"type":"table","label":"Illustrative risks","columns":["Trigger","Symptom","Potential handling"],"rows":[["Missing feedback","Rate uncertainty","Use larger reserve"],["Clock jump","Unverified timing","Mark uncertainty"],["Controller unavailable","Admission blocked","Fallback not established"],["Malformed packet","Drop / ignore","Validate fields first"]]}]}
```

## Risks and edge cases

```brief-section
{"id":"s-risks-and-edge-cases","anchors":[],"blocks":[{"type":"callout","label":"Evidence boundary","tone":"warning","text":"Large controller and egress diffs are absent from this illustration. Precise external-controller behavior, compatibility and observed latency cannot be concluded."},{"type":"list","label":"Questions worth testing","items":["How does the controller handle slow or missing feedback?","Does the receiver distinguish gaps from confirmed loss?","Are clock discontinuities preserved through the pipeline?"]}]}
```

## Open questions

```brief-section
{"id":"s-open-questions","anchors":[],"blocks":[{"type":"list","label":"Decisions beyond the pictured evidence","items":["How does the external controller define a latency target?","Are edge cases handled when a gap later fills?","What is the expected behavior when clock confidence is unverified?","Will this affect interoperability with existing deployments?"]}]}
```

## Supporting evidence

```brief-section
{"id":"s-supporting-evidence","anchors":["src/scream.rs:1","src/rtp.rs:1","docs/architecture.md:1"],"blocks":[{"type":"table","label":"Sample fixture sources","columns":["Reference","Role"],"rows":[["src/scream.rs:1-2","Illustrative policy and feedback changes"],["src/rtp.rs:1","Illustrative confidence metadata"],["docs/architecture.md:1","Illustrative system-map context"]]}]}
```

## Related briefs / prior context

```brief-section
{"id":"s-related-briefs","anchors":[],"blocks":[{"type":"table","label":"Illustrative references · no linked revisions","columns":["Topic","Connection"],"rows":[["Internal latency-policy design","Background for controller separation"],["RTP timing extension","Context for confidence metadata"],["Feedback accounting","Context for reordering rules"]]}]}
```

## Decision implications

```brief-section
{"id":"s-decision-implications","anchors":[],"blocks":[{"type":"list","label":"If this were a real implementation","items":["Confirm controller policy boundaries before treating latency gains as established.","Validate gap and reordering cases with packet-level tests.","Check interoperability when peers lack the confidence extension."]}]}
```

## Confidence boundaries

```brief-section
{"id":"s-confidence-boundaries","anchors":[],"blocks":[{"type":"callout","label":"Known from this sample","tone":"note","text":"The fixture contains changed lines for policy, feedback, timing and a diagram. This is illustrative source text, not a working implementation."},{"type":"callout","label":"Unknown from this sample","tone":"unknown","text":"Controller behavior, egress diffs, measured performance, interoperability and validation outcomes are not present. Do not infer them from the pictured layout."}]}
```

## Appendix

```brief-section
{"id":"s-appendix","anchors":[],"blocks":[{"type":"list","label":"Reference-only scope","items":["The sample mirrors the visual vocabulary of ref.png.","All module content is illustrative, not evidence of this repository's behavior.","No runtime validation, measured outcome or deployment is claimed."]}]}
```
