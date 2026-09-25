# Artwork preparation

`envelope-filigree.svg` is a native vector overlay for the responsive paper panels: fine champagne-gold fold seams, pearl dots, botanical corners, and engraved rosettes. The floral textures still come from the unchanged `envelope-unsealed.png`; CSS independently sizes and softly masks each bouquet and vine so a full-screen envelope does not stretch them. The original gold seal is separately sized at its natural proportions.

Source: `envelope-reference.png`, the user-supplied, approved image.
Output: `envelope-unsealed.png`, 941 × 1672 PNG.
Method: built-in `image_gen` image-edit tool. The original is unchanged.

Final editing prompt:

> Use case: precise-object-edit. Asset type: faithful matching layer for a CSS envelope opening animation. Edit this exact attached image. Remove ONLY the central gold wax seal, its dark cast shadow, and its Arabic inscription; seamlessly reconstruct the peach textured paper folds behind that seal. The upper triangular paper flap should terminate in a pointed tip at the seal's center (approximately x 49%, y 46% of the image). The lower flap and two side flaps should meet beneath it. Preserve all embossed flower and vine designs, their exact positions, all paper fold boundaries, the envelope's rectangular silhouette, the outer background, camera alignment, paper peach color and light/shadows everywhere else. No changes to florals, framing or aspect ratio. Keep original full portrait 941:1672 aspect ratio, full-bleed composition exactly registered to the input. This is the SAME CLOSED ENVELOPE but with its wax seal removed. Do not open it. No text, no added decoration, no wax remnants. Return only the edited photograph.
