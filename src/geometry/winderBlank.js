// Prostokąt produkcyjny (formatka) stopnia zabiegowego: opisany na konturze stopnia,
// zorientowany wzdłuż krawędzi CZOŁOWEJ — czyli pierwszej krawędzi napotykanej w kierunku
// wchodzenia, a więc `rearRiser` w nazewnictwie kodu (granica z poprzednim, niższym stopniem;
// `frontRiser` to granica z NASTĘPNYM stopniem, czyli krawędź wyjściowa, nie czołowa).
// Z konwencji produkcyjnej ta krawędź jest zawsze DŁUŻSZYM bokiem formatki. "długość" =
// rozpiętość rzutów wszystkich wierzchołków konturu na kierunek rearRiser, "głębokość" =
// rozpiętość rzutów prostopadle do niego — przedni narożnik (zwłaszcza bliżej duszy przy
// metodzie proporcjonalnej) często wystaje bokiem poza sam odcinek rearRiser, więc formatka
// bywa DŁUŻSZA niż sama krawędź czołowa. Współdzielone przez widok 3D i plan 2D, żeby liczby
// nigdy się nie rozjechały między nimi.
export function computeWinderBlank(tread) {
  const [inner1, outer1] = tread.rearRiser;
  const dir = { x: outer1.x - inner1.x, y: outer1.y - inner1.y };
  const len = Math.hypot(dir.x, dir.y) || 1;
  const ux = dir.x / len, uy = dir.y / len;
  const vx = -uy, vy = ux;

  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (const p of tread.outline) {
    const dx = p.x - inner1.x, dy = p.y - inner1.y;
    const u = dx * ux + dy * uy;
    const v = dx * vx + dy * vy;
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  }

  const corner = (u, v) => ({ x: inner1.x + u * ux + v * vx, y: inner1.y + u * uy + v * vy });
  return {
    length: maxU - minU,
    depth: maxV - minV,
    corners: [corner(minU, minV), corner(maxU, minV), corner(maxU, maxV), corner(minU, maxV)],
  };
}
