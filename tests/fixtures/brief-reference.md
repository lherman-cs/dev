# Branch consequence brief

```brief-lead
{"title":"Bottom line","body":"Illustrative reference sample, not a live assessment. The pictured change moves latency policy outside a SCReAM-like core and tightens feedback accounting: confirmed gaps do not immediately become loss, and packet timing carries clock-confidence metadata. Controller and egress behavior remain uncertain where the sample omits their diffs.","anchors":["src/scream.rs:1","src/rtp.rs:1"],"aside":{"label":"Evidence incomplete","text":"Controller and egress behavior are omitted from this sample. No claim about their implementation or measured effects is supported."}}
```

## What changed

```brief-section
{"id":"s-what-changed","kind":"overview","blocks":[{"type":"flow","steps":[{"title":"Latency policy moved","detail":"External to the core"},{"title":"Feedback gaps handled","detail":"Not immediate loss"},{"title":"Clock confidence added","detail":"Preserved in transit"},{"title":"Controller diffs omitted","detail":"Behavior unknown"}],"anchors":["src/scream.rs:1","src/rtp.rs:1"]}]}
```

## System map

```brief-section
{"id":"s-system-map","kind":"overview","anchors":["docs/architecture.md:1"],"blocks":[{"type":"text","text":"Architecture at a glance"},{"type":"columns","columns":[[{"type":"architecture","nodes":[{"title":"Sender","detail":"(egress)","notes":["RTP packets","Timing metadata","Clock confidence"]},{"title":"Network","icon":"cloud","detail":"Variable delay, reordering, loss, duplication"},{"title":"Receiver","detail":"(egress)","notes":["Feedback reports","ACK / loss + confidence","Controller (external)"]}]}],[{"type":"icon_list","label":"Key takeaways","items":[{"icon":"check","text":"Latency policy external","tone":"positive"},{"icon":"check","text":"Feedback carries richer state","tone":"positive"},{"icon":"check","text":"Clock confidence survives transit","tone":"positive"},{"icon":"info","text":"Egress behavior remains unknown","tone":"caution"}],"anchors":["src/scream.rs:1","src/rtp.rs:1"]}]],"widths":[3,1]}]}
```

## Change inventory

```brief-section
{"id":"s-change-inventory","kind":"overview","anchors":["src/scream.rs:1","src/rtp.rs:1"],"blocks":[{"type":"text","text":"Files and components shown by this illustration; not repository-wide totals"},{"type":"table","columns":["Module / component","Captured files","Lines +/−","Purpose / confidence"],"rows":[["SCReAM-like core","1 file","Not counted","Policy removal and provisional gap accounting"],["Transport / RTP","1 file","Not counted","Clock-confidence metadata"],["Controller (external)","Not captured","Unknown","Behavior not established"],["Egress / congestion","Not captured","Unknown","Behavior not established"]]}]}
```

## Latency policy is now external to the core

```brief-section
{"id":"s-latency-policy","nav":"Latency policy","anchors":["src/scream.rs:1"],"blocks":[{"type":"text","label":"Why it matters","text":"In the illustrated design, a queue-delay ceiling inside the core gives way to external admission and scheduling policy. The core keeps congestion accounting. The controller diff is absent, so deployed behavior remains unknown."},{"type":"columns","columns":[[{"type":"transition","label":"Architecture delta · illustrative","before":["Admission","Scheduling","Queue policy","Retransmission"],"after":["External controller (latency policy)","SCReAM core (congestion accounting)"]}],[{"type":"comparison","label":"Pseudocode comparison · illustrative","format":"code","before":"if queue_delay > target:\n  cut_rate()\nelse:\n  increase_rate()","after":"on_packet(pkt):\n  if controller.permits(pkt):\n    core.update_accounting()\n  # policy lives outside core"}],[{"type":"icon_list","label":"Ownership / key changes","items":[{"icon":"gear","text":"Policy in controller","detail":"Separate latency decisions"},{"icon":"shield","text":"Simpler core","detail":"Congestion accounting"},{"icon":"people","text":"Clearer separation","detail":"Can evolve independently"}]}]],"widths":[3,4,2]}]}
```

## Feedback gaps no longer immediately become loss

```brief-section
{"id":"s-feedback-gaps","nav":"Feedback gaps","anchors":["src/scream.rs:2"],"blocks":[{"type":"text","label":"Why it matters","text":"In the illustrated history, a gap stays provisional until later feedback or a reordering deadline. No observed loss rate or deployment effect can be inferred."},{"type":"columns","columns":[[{"type":"timeline","label":"Packet lifecycle (timeline)","tracks":[{"label":"Before: gap = loss","events":[{"label":"Packet sent","tone":"positive"},{"label":"Gap detected","tone":"negative"},{"label":"Immediate loss","tone":"negative"}]},{"label":"After: grace period","events":[{"label":"Packet sent","tone":"info"},{"label":"Gap detected"},{"label":"Wait for evidence","tone":"positive"},{"label":"ACK or loss","tone":"caution"}]}]}],[{"type":"diagram","label":"State machine (implied)","mermaid":"flowchart TB\n  A([Received]) --> B([Gap detected]) --> C[Wait for feedback]\n  C --> D([ACK: return credit])\n  C --> E([LOSS: after deadline])","takeaway":"A delayed ACK can restore receipt; a persistent gap after the deadline can become confirmed loss."}],[{"type":"comparison","label":"Pseudocode comparison · illustrative","format":"code","before":"on_feedback(pkt):\n  if gap_detected(pkt):\n    reduce_rate()","after":"on_feedback(pkt):\n  if gap_detected(pkt):\n    wait_for_report()\n  if deadline_passed():\n    confirm_loss()"},{"type":"icon_list","label":"Invariants / impact · design intent","items":[{"icon":"shield","text":"Accounting follows evidence","detail":"Reordering handled"},{"icon":"shield","text":"Avoids premature loss","detail":"Impact not measured"}]}]],"widths":[3,3,4]}]}
```

## Clock confidence survives packet transit

```brief-section
{"id":"s-clock-confidence","nav":"Clock confidence","anchors":["src/rtp.rs:1"],"blocks":[{"type":"text","label":"Why it matters","text":"The illustrated packet carries a confidence state with its timestamp. A receiver can retain synchronization uncertainty instead of treating all timestamps as equally trustworthy. Egress behavior is not captured."},{"type":"columns","columns":[[{"type":"table","label":"Packet data shape (RTP extension)","columns":["Field","Size","Description"],"rows":[["rtp_timestamp","32 bits","RTP timestamp"],["clock_confidence","2 bits","Clock-quality state"],["timing_extension","16 bits","Uncertainty reserve (illustrative)"],["…","…","Other RTP fields"]]}],[{"type":"icon_list","label":"Confidence states","items":[{"icon":"dot","tone":"positive","text":"Synchronized","detail":"Aligned source clock"},{"icon":"dot","tone":"caution","text":"Provisional","detail":"Recently synchronized"},{"icon":"dot","tone":"negative","text":"Unverified","detail":"No validation"},{"icon":"dot","tone":"info","text":"Discontinuous","detail":"Clock jump or reset"}]}],[{"type":"flow","label":"End-to-end propagation","steps":[{"title":"Ingress","detail":"Tag confidence"},{"title":"Network","detail":"Preserve field"},{"title":"Egress","detail":"Interpret uncertainty"}]},{"type":"icon_list","label":"Impact · intended, not verified","items":[{"icon":"info","text":"Confidence survives transit","detail":"If the extension is preserved"},{"icon":"warning","text":"Admission may adapt","detail":"Egress diff is absent","tone":"caution"}]}]],"widths":[4,3,4]}]}
```

## Data structures and protocol changes

```brief-section
{"id":"s-data-structures","nav":"Data structures","anchors":["src/rtp.rs:1","src/scream.rs:1"],"blocks":[{"type":"columns","columns":[[{"type":"list","label":"Key changes","items":["Add clock confidence to packet timing.","Separate provisional gaps from confirmed loss.","Check older peers when the extension is absent."],"anchors":["src/rtp.rs:1"]}],[{"type":"code","label":"RTP extension (schema · illustrative)","language":"rust","status":"pseudocode","text":"struct PacketTiming {\n  timestamp: u32,\n  confidence: ClockState, // 2 bits\n  uncertainty: Option<u16>,\n}","anchors":["src/rtp.rs:1"]}],[{"type":"flow","label":"Message format · illustrative","steps":[{"title":"RTP header","detail":"12 bytes (example)"},{"title":"Timing extension","detail":"optional; size unverified"},{"title":"Payload","detail":"variable"}],"anchors":["src/rtp.rs:1"]}]],"anchors":["src/rtp.rs:1"]}]}
```

## Call flow (end-to-end)

```brief-section
{"id":"s-call-flow","nav":"Call flow","anchors":["docs/architecture.md:1"],"blocks":[{"type":"columns","columns":[[{"type":"flow","steps":[{"title":"Capture","detail":"Packet timestamp"},{"title":"Tag","detail":"Clock confidence"},{"title":"Transmit","detail":"Over network"},{"title":"Receive","detail":"Process feedback"},{"title":"Update","detail":"Rate and state"}]}],[{"type":"list","label":"Notes","items":["Feedback processed separately from delivery.","Clock confidence preserved in the proposed path.","External controller handles admission policy."]}]],"widths":[4,1]}]}
```

## Configuration

```brief-section
{"id":"s-configuration","anchors":["src/scream.rs:1"],"blocks":[{"type":"columns","columns":[[{"type":"table","label":"New / changed settings · illustrative","columns":["Setting","Default","Description"],"rows":[["controller_enabled","true","Enable external controller"],["timing_reserve_ms","50","Uncertainty reserve"],["reorder_deadline_ms","200","Time before confirming loss"],["clock_confidence","required","Require metadata"]]}],[{"type":"code","label":"Example (TOML) · illustrative","language":"toml","status":"pseudocode","text":"[core]\ncontroller_enabled = true\ntiming_reserve_ms = 50\nreorder_deadline_ms = 200\nclock_confidence = 'required'"}]],"widths":[3,2]}]}
```

## Invariants

```brief-section
{"id":"s-invariants","anchors":["src/scream.rs:1"],"blocks":[{"type":"columns","columns":[[{"type":"icon_list","label":"Must · design intent","items":[{"icon":"check","tone":"positive","text":"Preserve packet integrity"},{"icon":"check","tone":"positive","text":"Maintain ordering"},{"icon":"check","tone":"positive","text":"Honor clock confidence"},{"icon":"check","tone":"positive","text":"Fail safely on missing data"}]}],[{"type":"icon_list","label":"Must not · design intent","items":[{"icon":"warning","tone":"negative","text":"Treat gaps as immediate loss"},{"icon":"warning","tone":"negative","text":"Remove confidence metadata"},{"icon":"warning","tone":"negative","text":"Break compatibility silently"},{"icon":"warning","tone":"negative","text":"Reduce observability"}]}]]}]}
```

## Behavior scenarios

```brief-section
{"id":"s-scenarios","anchors":["src/scream.rs:2","src/rtp.rs:1"],"blocks":[{"type":"columns","columns":[[{"type":"icon_list","label":"A · Normal operation · intended","items":[{"icon":"check","tone":"positive","text":"Synchronized clock"},{"icon":"check","tone":"positive","text":"Packets in order"},{"icon":"check","tone":"positive","text":"ACKs arrive on time"},{"icon":"check","tone":"positive","text":"Stable accounting"}]}],[{"type":"icon_list","label":"B · Reordered packets · intended","items":[{"icon":"check","tone":"positive","text":"Gap detected"},{"icon":"check","tone":"positive","text":"Wait for later feedback"},{"icon":"check","tone":"positive","text":"Late packet may fill gap"},{"icon":"check","tone":"positive","text":"No immediate loss"}]}],[{"type":"icon_list","label":"C · Uncertain timing · intended","items":[{"icon":"check","tone":"positive","text":"Unverified clock"},{"icon":"check","tone":"positive","text":"Larger admission reserve"},{"icon":"check","tone":"positive","text":"Conservative sending"},{"icon":"warning","tone":"caution","text":"Egress behavior unverified"}]}],[{"type":"icon_list","label":"D · Missing feedback · intended","items":[{"icon":"check","tone":"positive","text":"Feedback absent"},{"icon":"check","tone":"positive","text":"Use larger reserve"},{"icon":"check","tone":"positive","text":"Avoid false loss signals"},{"icon":"warning","tone":"caution","text":"Recovery unknown"}]}]]}]}
```

## Validation

```brief-section
{"id":"s-validation","blocks":[{"type":"table","label":"Reference illustration only · no checks executed for this sample","columns":["Test / scenario","Status","Coverage","Notes"],"rows":[["ACK credit advancement","Not run","Unknown","Unit test required"],["Gap handling / reordering","Not run","Unknown","Integration test required"],["Clock confidence propagation","Not run","Unknown","Packet-level test required"],["End-to-end with controller","Not run","Unknown","Controller diff omitted"],["Egress behavior","Not run","Not covered","Egress diff omitted"]]}]}
```

## Compatibility matrix

```brief-section
{"id":"s-compatibility","anchors":[],"blocks":[{"type":"table","label":"Illustrative expectations · unverified","columns":["Client / server","Old peer","New peer","Mixed peers"],"rows":[["Old","Unknown","Unknown","Unknown"],["New","Unknown","Unknown","Unknown"],["Mixed","Unknown","Unknown","Unknown"]]},{"type":"callout","label":"Boundary","tone":"unknown","text":"The pictured matrix is a design prompt, not observed compatibility. No interoperability run is represented here."}]}
```

## Performance / operational impact

```brief-section
{"id":"s-performance-impact","nav":"Performance impact","blocks":[{"type":"table","label":"Potential impacts, not measured effects","columns":["Metric","Change","Reason to investigate"],"rows":[["End-to-end latency","Unknown","Controller path adds a policy boundary"],["CPU usage","Unknown","Additional metadata and state"],["Network overhead","Unknown","Clock confidence extension"],["Operational complexity","Unknown","Separate controller lifecycle"]]}]}
```

## Failure modes

```brief-section
{"id":"s-failure-modes","anchors":["src/scream.rs:2"],"blocks":[{"type":"table","label":"Illustrative risks; recoverability not tested","columns":["Trigger","Symptom","Potential handling","Recoverability"],"rows":[["Missing feedback","Rate uncertainty","Use larger reserve","Unknown"],["Clock jump","Unverified timing","Mark uncertainty","Unknown"],["Controller unavailable","Admission blocked","Fallback not established","Unknown"],["Malformed packet","Drop / ignore","Validate fields first","Unknown"]]}]}
```

## Risks and edge cases

```brief-section
{"id":"s-risks-and-edge-cases","nav":"Risks & edge cases","blocks":[{"type":"icon_list","items":[{"icon":"warning","tone":"caution","text":"Controller behavior is not visible","detail":"Its diff is absent"},{"icon":"warning","tone":"caution","text":"Egress behavior remains uncertain","detail":"The omitted diff may change effects"},{"icon":"warning","tone":"caution","text":"Real-world performance depends on deployment","detail":"No measurement is supplied"},{"icon":"warning","tone":"caution","text":"Interop requires testing","detail":"Older peers may lack the extension"}]}]}
```

## Open questions

```brief-section
{"id":"s-open-questions","blocks":[{"type":"icon_list","items":[{"icon":"question","text":"How does the external controller define latency targets?"},{"icon":"question","text":"Are late ACKs handled when a gap fills?"},{"icon":"question","text":"What if clock confidence is unverified?"},{"icon":"question","text":"How do existing deployments interoperate?"}]}]}
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
{"id":"s-appendix","blocks":[{"type":"list","label":"Reference-only scope","items":["Illustrative composition of the reference visual vocabulary.","No runtime validation or deployment is claimed.","Compare each row with the reference; side-by-side sections are deliberately unsupported."]}]}
```
