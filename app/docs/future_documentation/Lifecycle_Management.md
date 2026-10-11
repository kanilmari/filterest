<!-- Describes lifecycle management across named Filterest things. -->
<!-- Connects target identity, phase models and recorded lifecycle decisions. -->
<!-- Gives the owner and agents a durable description of the missing capability. -->
<!-- Implementation follows a working mobile and desktop publication. -->

# Lifecycle Management

## What it makes possible

Lifecycle management gives the owner and agents a shared way to understand
where each named thing in Filterest is in its life, how it reached that point
and which transitions make sense next. The owner can compare targets, see the
reasons for decisions and distinguish readiness from an accepted completion or
publication. Agents can recover context from recorded history and act according
to the target's own phase model rather than infer its state from a name or an
isolated report.

The capability covers different kinds of things without making them follow
one universal sequence. Research and planning may begin a workline; birth may
begin a site. Lifecycle management describes the life of the target itself,
including its history across changes of name or responsibility.

## Concepts and target kinds

A **lifecycle target** is an identifiable, named thing whose life is followed.
Its **kind** describes what it is and selects an appropriate **phase model**.
A model defines meaningful phases and the transitions between them. The
target's **current phase** describes where it is now; its **history** preserves
earlier phases and the decisions or events that explain them.

| Target kind | What its lifecycle can explain |
| --- | --- |
| Component | How a product responsibility becomes usable, evolves and is eventually replaced or retired. |
| Development practice | How a way of working is explored, adopted, reviewed and superseded. |
| Workline | How a finite agreed scope moves from orientation to explicit closure. |
| Ticket | How an individual request is understood, addressed, verified and closed. |
| Site | How a named site moves from birth to publication and later life. |
| Other named thing | The life of another identifiable Filterest entity using a model suited to its kind. |

Targets keep their own identities and purposes. Following a component's life
does not turn it into a ticket, and following a ticket does not make it a
workline. A target kind may share a phase model with another kind when their
phase meanings agree. Tickets are candidates for the workline's six-phase
model; that does not require every target kind to use it.

## Phase models

### Workline: six phases

The workline example uses the six-phase meanings of the shared development
workflow represented by the Workline Observatory:

| Phase | Name | Meaning |
| --- | --- | --- |
| 1 | Orient | Understand the request, the existing capability and the whole agreed scope before deciding what to change. |
| 2 | Plan | Choose the approach and the principles that guide implementation and verification. |
| 3 | Implement | Carry out the agreed changes, including required data changes; individual changes can be tested during this phase. |
| 4 | Verify | Check the whole result once all agreed implementation is complete, including likely regressions. |
| 5 | Capture knowledge and review | Update the knowledge that future work depends on and review the result against the agreed scope. |
| 6 | Close | Prepare or complete the authorized handoff and repository actions for the complete scope; record the explicit closure decision. |

The Observatory's not-started marker precedes these six phases. A phase
describes the entire agreed scope, not its most advanced part. Finding a missing
requirement or an implementation defect returns the workline to implementation
while preserving what was already done.

Progress and lifecycle status remain distinct: a workline can be active or
paused at a phase. Reaching the closing phase does not itself close the
workline; explicit acceptance or a closure decision is still needed. Discarding
work likewise records a decision without claiming that every phase succeeded.

### Site: birth to publication

A site's model can begin with its existence and end this part of its life with
publication. The following is an example of suitable phase meanings, rather
than another mandatory six-phase sequence:

| Phase | Meaning |
| --- | --- |
| Birth | The site has an identity, a name and a purpose, even before it is available to visitors. |
| Preparation | Its content, behavior and operating conditions are being made ready for its intended audience. |
| Ready for publication | The intended experience has been verified and awaits the publication decision. |
| Published | The site has been made available to its intended audience and the publication event is recorded. |

Published need not mean the end of a site's life. A site model can also describe
maintenance, suspension or retirement when those distinctions are needed.
Publication of a site and completion of work on it remain separate events.

## General data model

The data can be understood as related collections or tables, without fixing
their physical names, storage types or implementation layout:

| Conceptual record | Data and relationships |
| --- | --- |
| Lifecycle target | Stable identity, name and kind, with a reference to the named thing whose life is followed. |
| Phase model | Identity, name, applicable target kinds, phase meanings and permitted transitions. |
| Phase | Identity within a model, name, meaning and any entry or completion conditions. |
| Target lifecycle | The target, its assigned phase model, its current phase and relevant lifecycle data, such as responsibility or a decision awaiting acceptance. |
| Lifecycle history entry | The target and model, the previous and resulting phases, when the event occurred, who or what recorded it, the reason, evidence and other relevant data. |

Each current phase belongs to the target's assigned model. The target links its
current phase to its history so the owner and agents can understand both the
present state and the path taken. An initial history entry can record birth or
entry into a model; later entries can record transitions, decisions and changes
of model without erasing earlier meanings.

## Timing prerequisite

Lifecycle management comes after Filterest has been published and works for
both mobile and desktop use. It must not precede that publication. This is a
durable ordering condition; worklines and tickets own the implementation status,
scheduling and release assignment.

## Implementation principles

- **One authority per target:** integrate with existing target identities and
  the Workline Observatory rather than create a competing register of worklines,
  tickets or sites. Decide which component owns transitions and have every
  interface and agent use that same authority.
- **Consistent transitions:** validate a transition against its model and the
  actor's permissions. Record the new phase and its history together, and
  reject stale concurrent decisions rather than silently overwrite them.
- **Preserve past meaning:** changing a phase model must not reinterpret old
  history. Retain the model meaning used by each entry and make corrections or
  model changes explicit, with evidence where available.
- **Respect product boundaries:** use supported application operations and
  versioned migrations, keep lifecycle data under the target's access rules,
  and provide translated names and usable light and dark presentations.
