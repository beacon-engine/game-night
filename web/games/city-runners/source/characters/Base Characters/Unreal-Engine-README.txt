The Unreal Engine models were exported in GLTF because of a known scaling bug when importing rigged FBXs from Blender. It recognizes the units wrong and breaks retargeting in some cases.
Strongly suggest also using GLTF if you want to re-export.

To import just drag and drop the .glTF.