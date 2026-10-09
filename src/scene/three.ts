import {
  AdditiveBlending, AmbientLight, BackSide, BufferAttribute, BufferGeometry, CanvasTexture, CatmullRomCurve3, ClampToEdgeWrapping,
  Color, ConeGeometry, DirectionalLight, DoubleSide, Group, Line, LineBasicMaterial, LineDashedMaterial, LineSegments, LinearFilter,
  LinearMipmapLinearFilter, Matrix4, Mesh, MeshBasicMaterial, MeshPhongMaterial, PerspectiveCamera, Points, PointsMaterial, REVISION,
  Raycaster, RingGeometry, Scene, ShaderMaterial, SphereGeometry, Sprite, SpriteMaterial, Texture, TubeGeometry, Vector2, Vector3,
  WebGLRenderer, WireframeGeometry, sRGBEncoding
} from 'three';

/* three.js r128, as much of it as the scene uses. The old modules were written against a global `THREE` and use it as a namespace
 * object; this is that object with the forty-odd members they name and nothing else, so the bundler can drop the rest of the
 * library (the full namespace would pin all of it: a namespace passed around as a value cannot be shaken). The list is the set of
 * `THREE.<name>` in orbit3d.ts, orbitviz.ts and globetex.ts - a name added to them has to be added here, and the test that builds
 * the scene says so when one is missing. (`SRGBColorSpace` is newer than r128: the old code asks for it first and falls back
 * to `sRGBEncoding`, so it is left out on purpose.) three is pinned at 0.128.0: the palette and the day/night shader are tuned to
 * its output encoding. */
export const THREE = {
  AdditiveBlending, AmbientLight, BackSide, BufferAttribute, BufferGeometry, CanvasTexture, CatmullRomCurve3, ClampToEdgeWrapping,
  Color, ConeGeometry, DirectionalLight, DoubleSide, Group, Line, LineBasicMaterial, LineDashedMaterial, LineSegments, LinearFilter,
  LinearMipmapLinearFilter, Matrix4, Mesh, MeshBasicMaterial, MeshPhongMaterial, PerspectiveCamera, Points, PointsMaterial, REVISION,
  Raycaster, RingGeometry, Scene, ShaderMaterial, SphereGeometry, Sprite, SpriteMaterial, Texture, TubeGeometry, Vector2, Vector3,
  WebGLRenderer, WireframeGeometry, sRGBEncoding
};
