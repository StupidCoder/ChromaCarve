# Captain Toad: section-repair investigation

Tested the user-supplied `kinopio.glb`, exported by RetroReverse from Captain Toad
Treasure Tracker (Nintendo 3DS). The file itself, textures and extracted contours
are not included in this repository.

## Reproduction

Rest pose, 150 mm longest side, 3 mm plywood, horizontal slicing, zero sampling
offset. The source is 99.40 × 150 × 121.51 mm, with 2,478 triangles across 14
render meshes and 136 open mesh edges. All materials are double-sided; the eye
material is blended. A visually solid render therefore does not imply a closed
triangle mesh. The slicer uses the posed triangle surfaces, not texture opacity.

Strict slicing produces 50 layers: 11 have valid contours, 26 have open paths,
and 13 have intersecting outlines. The global open-mesh error also blocks the
assembled preview even where an individual layer has valid contours.

With automatic repair and **1 mm tolerance**, every layer produces closed,
non-crossing polygon boundaries: **50 layers, 90 separate pieces**. There are
**12 stitched seams** and **41 attached or absorbed open paths**. The assembled
bounds are approximately **98.39 × 150 × 121.23 mm**; the difference from the
source bounds is the normal sampling loss. This does not establish that all
pieces are strong enough or have adequate glue contact.

## What needed repair

- **Overlapping closed outlines:** union them instead of interpreting overlap as
  empty space. Fully contained, oppositely oriented boundaries remain cavities;
  nested solids with matching orientation are unioned. The backpack cavity stays.
- **Material seams around the arms (layers 17–19):** nearly matching endpoints
  belong to different paths. Stitch their mutual nearest ends before closing
  anything. Several apparent 69 mm openings then disappear without a 69 mm fill.
- **Open shells hidden by other parts:** some original paths have endpoints
  24–53 mm apart. Their proposed closing edge is checked over its entire length.
  Closing inside already-filled material adds no unsupported span. This handles
  the backpack/body, face/head and lamp/strap relationships in the rest pose.
- **Small clearance to an underlying solid:** a narrow attachment strip joins an
  open patch to the nearest existing boundary. Merely closing the patch would
  leave it floating. Tolerance limits the distance to existing material; it is
  not permission to fill an arbitrary large opening.
- **Eye area (layer 26):** at 0.5 mm, two paths remain unresolved. A 1 mm tolerance
  attaches both to the face. Those are the last unresolved paths in the rest pose.

At 0 mm, layers 14, 17–19 and 26–28 remain unresolved. At 0.25 mm, the arm seams
are resolved but layers 14 and 26–28 remain. At 0.5 mm, only layer 26 remains.
The geometry is computed in millimetres; changing the character size or pose can
change the tolerance required.

## Layer-by-layer result

Layer numbers count from the bottom. “Open” and “Overlap” describe the strict
result. “Attach” counts open paths whose closure is supported by other material;
“Stitch” counts short endpoint joins. “Pieces” is the final 1 mm result. Some
closed regions are genuinely disconnected, such as the shoes, fingers, backpack
features and lamp. They remain separate pieces.

| Layer | Original | Stitch | Attach | Pieces | Resolved at 0.5 mm? |
| --- | --- | ---: | ---: | ---: | --- |
| 1 | Valid | 0 | 0 | 2 | Yes |
| 2 | Valid | 0 | 0 | 3 | Yes |
| 3 | Valid | 0 | 0 | 3 | Yes |
| 4 | Valid | 0 | 0 | 3 | Yes |
| 5 | Overlap | 0 | 0 | 2 | Yes |
| 6 | Open | 0 | 1 | 1 | Yes |
| 7 | Open | 0 | 1 | 1 | Yes |
| 8 | Open | 0 | 1 | 1 | Yes |
| 9 | Open | 0 | 1 | 1 | Yes |
| 10 | Open | 0 | 1 | 1 | Yes |
| 11 | Open | 0 | 4 | 1 | Yes |
| 12 | Open | 0 | 4 | 1 | Yes |
| 13 | Open | 0 | 1 | 1 | Yes |
| 14 | Open | 0 | 1 | 1 | Yes |
| 15 | Open | 0 | 2 | 1 | Yes |
| 16 | Open | 0 | 2 | 5 | Yes |
| 17 | Open | 4 | 0 | 2 | Yes |
| 18 | Open | 4 | 2 | 8 | Yes |
| 19 | Open | 4 | 2 | 3 | Yes |
| 20 | Open | 0 | 1 | 3 | Yes |
| 21 | Open | 0 | 1 | 3 | Yes |
| 22 | Overlap | 0 | 0 | 3 | Yes |
| 23 | Overlap | 0 | 0 | 4 | Yes |
| 24 | Overlap | 0 | 0 | 1 | Yes |
| 25 | Overlap | 0 | 0 | 1 | Yes |
| 26 | Open | 0 | 3 | 1 | No |
| 27 | Open | 0 | 3 | 1 | Yes |
| 28 | Open | 0 | 3 | 1 | Yes |
| 29 | Open | 0 | 1 | 1 | Yes |
| 30 | Open | 0 | 1 | 1 | Yes |
| 31 | Overlap | 0 | 0 | 1 | Yes |
| 32 | Overlap | 0 | 0 | 1 | Yes |
| 33 | Overlap | 0 | 0 | 1 | Yes |
| 34 | Overlap | 0 | 0 | 1 | Yes |
| 35 | Overlap | 0 | 0 | 1 | Yes |
| 36 | Overlap | 0 | 0 | 2 | Yes |
| 37 | Overlap | 0 | 0 | 2 | Yes |
| 38 | Open | 0 | 1 | 2 | Yes |
| 39 | Open | 0 | 1 | 1 | Yes |
| 40 | Open | 0 | 1 | 1 | Yes |
| 41 | Open | 0 | 1 | 1 | Yes |
| 42 | Open | 0 | 1 | 1 | Yes |
| 43 | Overlap | 0 | 0 | 2 | Yes |
| 44 | Valid | 0 | 0 | 2 | Yes |
| 45 | Valid | 0 | 0 | 2 | Yes |
| 46 | Valid | 0 | 0 | 2 | Yes |
| 47 | Valid | 0 | 0 | 2 | Yes |
| 48 | Valid | 0 | 0 | 2 | Yes |
| 49 | Valid | 0 | 0 | 1 | Yes |
| 50 | Valid | 0 | 0 | 1 | Yes |

## Other poses and limits

At the same 1 mm tolerance, `Wait` at 0 s and 3 s, `CourseInRove` at 0 s, and
`WaitRove` at 0 s also resolve all layers. Some other tested poses still contain
unsupported paths: `Walk` at 0 s retains errors in layers 14, 16 and 18;
`CourseInRove` at 3.25 s retains layers 17 and 29. The tool keeps these errors
visible and blocks a complete plywood preview. Inspect them before increasing
tolerance; changing sampling offset or repairing the source may be preferable.

This is section repair, not a watertight 3D remesher. It does not infer thickness
for isolated sheets, use textures to reconstruct missing faces, fill all cavities,
convex-hull the model, or bridge arbitrary gaps. Ambiguous branching paths and
mesh winding/non-manifold errors still require intervention. Very small islands,
point contacts and insufficient overlap between adjacent layers need the assembly
analysis portion of milestone 4. Kerf, markings and sheet nesting are later work.

## Implementation and verification

Enable **Repair overlapping / open sections** under Physical setup. Use
**Cross-sections → Show original contours and repair connections**: orange shows
the source intersections, pink the inserted closing edges, and blue the repaired
material, including narrow attachment strips. The comparison preview extrudes
those same repaired contours. Disable repair to return to strict behavior.

Boolean operations use Clipper's integer-grid nonzero fill. Grid spacing is the
existing numerical welding tolerance (`max(1e-8, sizeMm × 1e-7)`), not a visible
smoothing radius. The worker reports unresolved paths and enforces repair
complexity limits. The source asset is never modified. Repair settings persist
with the Slices project.

Synthetic tests cover overlapping/nested solids, cavities and islands, short seam
stitching, supported long openings, narrow attachment strips, unsupported openings,
branching paths, complexity limits, strict-mode isolation and persisted settings.
An optional local integration test checks the supplied model, all 50 rest-pose
layers, the 0.5 mm unresolved layer, 1 mm repair totals and plywood extrusion:

```sh
SLICES_CAPTAIN_TOAD_GLB='/absolute/path/to/kinopio.glb' npm test
```

Without the environment variable, that one proprietary-fixture test is skipped;
the synthetic tests run normally. Browser verification uses the original textured
GLB. The Node fixture test strips texture references only, retaining skinning,
animations and node transforms.

Sources: [Clipper documentation](https://github.com/junmer/clipper-lib/blob/master/Documentation.md)
for integer polygon booleans. [Generalized winding numbers](https://users.cs.utah.edu/~ladislav/jacobson13robust/jacobson13robust.html)
are a possible future fallback for more ambiguous open meshes; this implementation
does not use them or claim to reconstruct arbitrary missing surfaces.
