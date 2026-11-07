# Material references

BIM-BEM-BOM builds its materials library (`data/materials.db`) from these
sources:

- **EnergyPlus's DataSets**, read from your EnergyPlus installation: the ASHRAE
  2005 Handbook of Fundamentals materials, the window constructions and the
  glass and gas materials.
- **The openstudio-standards materials catalogue**, downloaded once from a pinned
  commit and kept in `data/cache/` (BSD-style licence, see
  THIRD-PARTY-NOTICES.md).
- **Your own entries**, typed in the materials dialog, each with the source you
  name.

None of these numbers ship with BIM-BEM-BOM. The ASHRAE Handbook materials are
ASHRAE's, and most catalogue rows cite California's Title 24-2013. Using them
in your work, or any standard or product value you type in, may require your
own copy or license from the publisher (THIRD-PARTY-NOTICES.md, "Data owned by
others in the materials library").

## `opus-keyword-map.csv`

This file maps the words an IFC file uses for a material (for example "cast in
place", "C30" or "reinforced concrete") to the openstudio-standards catalogue
row that carries the material's numbers. It holds only words and catalogue
keys, with no material values. It was derived with Claude Opus for this project.

Columns: `opus_id`, `opus_name`, `category`, `keywords` (separated by `;`),
`target_key`, `target_name`, `target_source`, `matched_by`. A row with no
`target_key` maps no catalogue row, and its keywords are not used.

## Window and door ratings

No manufacturer or NFRC ratings ship with BIM-BEM-BOM. To model a specific
product, look up its certified U-factor, SHGC and VT in the
[NFRC Certified Products Directory](https://search.nfrc.org/) or in the
manufacturer's literature, and type them in the window dialog with that source.
