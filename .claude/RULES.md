# RULES FOR STAIR3D DEVELOPMENT

These rules govern the architecture and workflow for this project. They apply
to every change, regardless of how small. If a task conflicts with these
rules, the architecture is refactored — the rules are not bent.

1. **2D parametric model is the source of truth.**
   All stair geometry (steps, stringers, plan layout, turns) is defined by
   parameters in the 2D model. Nothing is "true" unless it is derivable from
   that model.

2. **3D is derived from 2D.**
   The 3D scene (Three.js meshes) is a pure projection/extrusion of the 2D
   model plus its solved geometry. 3D never holds independent state.

3. **Never patch rendered meshes to compensate for incorrect source geometry.**
   If a mesh looks wrong, the bug is upstream in the model or solver. Fix it
   there, not by nudging vertices/transforms in the renderer.

4. **Manual edits modify model parameters/overrides, never Three.js meshes
   directly.**
   Drag-and-drop, offsets, manual edge edits, etc. write to the model (as
   parameters or explicit overrides), then flow through the normal
   solve → render pipeline.

5. **Stringers must remain straight and parallel within each straight
   flight.**
   Any solver change that could affect stringer lines must preserve this
   invariant for every straight flight segment.

6. **Step geometry and stringer geometry are separate but dependent
   systems.**
   They are computed independently, with stringer geometry consuming step
   geometry as input — never the reverse, and never merged into one
   computation.

7. **Recalculate dependent geometry after every model change.**
   No stale derived geometry. A model mutation invalidates and recomputes
   everything downstream of it.

8. **Never duplicate geometric rules in multiple modules.**
   A given geometric rule (e.g. "how a riser board sits on the raw line")
   lives in exactly one place and is reused, not reimplemented.

9. **Geometry calculations must be pure where possible.**
   Solver/geometry functions take inputs and return outputs with no hidden
   state, no mutation of shared objects, no side effects. This makes them
   testable and composable.

10. **Separate concerns into distinct layers:**
    - **model** — parametric data + overrides (source of truth)
    - **solver** — pure geometry derivation from the model
    - **validation** — checks that model/solver output is physically/
      geometrically sane
    - **rendering** — Three.js scene construction from solved geometry
    - **UI** — user interaction, editing, and display

    Code in one layer must not reach into another layer's internals.

11. **Do not introduce magic numbers.**
    Any numeric constant with geometric or physical meaning must be named.

12. **Every geometric rule must have a named constant or function.**
    If a rule can be stated in words ("stringer thickness offset from tread
    nosing"), it must exist in code as a single named, documented unit —
    not inlined arithmetic scattered across call sites.

13. **Every bug fix involving geometry must add a regression test.**
    No geometry bug is considered fixed until a test reproduces the failure
    case and asserts the corrected behavior.

14. **Never solve a structural geometry problem with a renderer-specific
    hack.**
    If a fix only works around a Three.js quirk without correcting the
    underlying geometric computation, it is not an acceptable fix.

15. **Preserve project JSON compatibility through explicit schema versions.**
    Any change to the saved project format bumps a schema version and
    includes a migration path for older files. Silent format drift is not
    allowed.

16. **If the existing architecture conflicts with these rules, refactor the
    architecture instead of adding another workaround.**
    Workarounds that violate these rules are technical debt, not solutions.
