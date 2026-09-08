import * as THREE from 'three';

const NEWEL_HEIGHT = 1000; // mm, wysokość słupka początkowego/końcowego ponad poziom podłogi

function boxAt(centerX, centerY, zBottom, zTop, size) {
  const height = zTop - zBottom;
  const geometry = new THREE.BoxGeometry(size, height, size);
  geometry.translate(0, height / 2, 0);
  const mesh = new THREE.Mesh(geometry);
  mesh.position.set(centerX, zBottom, -centerY);
  return mesh;
}

// Nosek jest teraz na TYLNEJ krawędzi stopnia (patrz treadGeometry.js) — czyli dokładnie tam,
// gdzie stoi słup startowy. Przesuwamy słup startowy DO PRZODU (przeciwnie do kierunku
// wchodzenia) o połowę jego rozmiaru, żeby jego tylne lico leżało na linii konstrukcyjnej —
// inaczej słup (np. 110mm) wizualnie połyka/zasłania nosek pierwszego stopnia (np. 25mm),
// bo oba sięgają w tę samą przestrzeń za linią startu.
function boxAtForward(point, forwardDir, zBottom, zTop, size) {
  const shifted = { x: point.x + forwardDir.x * (size / 2), y: point.y + forwardDir.y * (size / 2) };
  return boxAt(shifted.x, shifted.y, zBottom, zTop, size);
}

function unitDir(pFrom, pTo) {
  const dx = pTo.x - pFrom.x;
  const dy = pTo.y - pFrom.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

export function buildPosts(planLayout, config) {
  const group = new THREE.Group();
  group.name = 'Posts';
  const { postSize, totalRise } = config;

  const path = planLayout.innerFullPath;
  const startPoint = path[0];
  const endPoint = path[path.length - 1];
  const startForward = unitDir(path[0], path[1]);

  const startPost = boxAtForward(startPoint, startForward, 0, NEWEL_HEIGHT, postSize);
  startPost.name = 'Post_Start';
  group.add(startPost);

  // Ostatni stopień nie ma noska na swojej przedniej (górnej) krawędzi — nosek jest tylko
  // na tylnych krawędziach — więc słup końcowy nie koliduje z niczym i zostaje wyśrodkowany.
  const endPost = boxAt(endPoint.x, endPoint.y, totalRise - NEWEL_HEIGHT, totalRise, postSize);
  endPost.name = 'Post_End';
  group.add(endPost);

  if (config.hasCornerPost) {
    // Przy "1 dużym podeście" (patrz planLayout.js/mergeLandingPair) oba zakręty mają
    // dokładnie ten sam innerCorner (wspólny słup na środku krawędzi podestu) — bez
    // odfiltrowania duplikatu dostalibyśmy dwa identyczne, nakładające się słupy.
    const placedCorners = [];
    planLayout.turns.forEach((turn, i) => {
      const isDuplicate = placedCorners.some(
        (c) => Math.hypot(c.x - turn.innerCorner.x, c.y - turn.innerCorner.y) < 1
      );
      if (isDuplicate) return;
      placedCorners.push(turn.innerCorner);
      const cornerPost = boxAt(turn.innerCorner.x, turn.innerCorner.y, 0, totalRise, postSize);
      cornerPost.name = `Post_Corner_${i}`;
      group.add(cornerPost);
    });
  }

  return group;
}
