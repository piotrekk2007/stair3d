import { downloadTextFile } from './downloadTextFile.js';

// Uwaga: OBJ nie niesie jednostek. Model jest budowany w milimetrach — przy imporcie
// (przez wtyczkę, bo Make nie ma natywnego importu OBJ) trzeba jawnie ustawić jednostkę
// importu na milimetry, inaczej wynik będzie w złej skali.
//
// Ręczny serializer (zamiast wbudowanego THREE.OBJExporter) — potrzebny, żeby dodać
// grupowanie kategorii (Wangi/Słupy/Stopnie) przez dyrektywy "g", niezależnie od
// nazwy poszczególnej siatki ("o"). Dyrektywa "g" w OBJ jest bardzo starym, szeroko
// wspieranym standardem — więcej importerów respektuje ją niż hierarchię węzłów COLLADA.

const GROUP_LABEL_BY_PARENT = {
  Treads: 'Stopnie',
  StringerOuter: 'Wangi',
  StringerInner: 'Wangi',
  Posts: 'Slupy',
  RiserBoards: 'Podstopnie',
};

function sanitizeName(name, index) {
  const base = (name || 'mesh').replace(/[^a-zA-Z0-9_]/g, '_');
  return `${base}_${index}`;
}

// categoryFilter: { Stopnie: bool, Wangi: bool, Slupy: bool } — pozwala wyeksportować
// tylko wybrane kategorie do osobnych plików (jeden import w SketchUp = jedna grupa).
export function exportStaircaseToOBJ(root, filename = 'schody.obj', categoryFilter = null) {
  const meshes = [];
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    const parentName = obj.parent ? obj.parent.name : null;
    const label = GROUP_LABEL_BY_PARENT[parentName] || 'Stopnie';
    if (categoryFilter && !categoryFilter[label]) return;
    meshes.push(obj);
  });

  // Grupujemy siatki wg kategorii, żeby wszystkie "g Wangi" siedziały razem w pliku
  // (jedna ciągła dyrektywa grupy), a nie przeplatały się z innymi kategoriami.
  const byGroup = new Map();
  meshes.forEach((mesh, i) => {
    const parentName = mesh.parent ? mesh.parent.name : null;
    const label = GROUP_LABEL_BY_PARENT[parentName] || 'Stopnie';
    if (!byGroup.has(label)) byGroup.set(label, []);
    byGroup.get(label).push({ mesh, index: i });
  });

  const lines = ['# schody3d — eksport OBJ, jednostki: mm'];
  let vertexOffset = 0;
  let normalOffset = 0;

  for (const [label, entries] of byGroup) {
    lines.push(`g ${label}`);
    for (const { mesh, index } of entries) {
      const geo = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
      mesh.updateMatrixWorld(true);
      const posAttr = geo.attributes.position;
      let normAttr = geo.attributes.normal;
      if (!normAttr) {
        geo.computeVertexNormals();
        normAttr = geo.attributes.normal;
      }

      lines.push(`o ${sanitizeName(mesh.name, index)}`);

      // ręczna transformacja przez matrixWorld (ten sam wymóg co w daeExporter.js —
      // słupy polegają na mesh.position, nie mają współrzędnych świata "wypieczonych")
      const m = mesh.matrixWorld.elements;
      for (let i = 0; i < posAttr.count; i++) {
        const x = posAttr.getX(i), y = posAttr.getY(i), z = posAttr.getZ(i);
        const wx = m[0] * x + m[4] * y + m[8] * z + m[12];
        const wy = m[1] * x + m[5] * y + m[9] * z + m[13];
        const wz = m[2] * x + m[6] * y + m[10] * z + m[14];
        lines.push(`v ${wx.toFixed(4)} ${wy.toFixed(4)} ${wz.toFixed(4)}`);
      }
      for (let i = 0; i < normAttr.count; i++) {
        lines.push(`vn ${normAttr.getX(i).toFixed(4)} ${normAttr.getY(i).toFixed(4)} ${normAttr.getZ(i).toFixed(4)}`);
      }
      for (let i = 0; i < posAttr.count; i += 3) {
        const a = vertexOffset + i + 1;
        const b = vertexOffset + i + 2;
        const c = vertexOffset + i + 3;
        const na = normalOffset + i + 1;
        const nb = normalOffset + i + 2;
        const nc = normalOffset + i + 3;
        lines.push(`f ${a}//${na} ${b}//${nb} ${c}//${nc}`);
      }
      vertexOffset += posAttr.count;
      normalOffset += normAttr.count;
    }
  }

  downloadTextFile(lines.join('\n'), filename, 'text/plain');
}
