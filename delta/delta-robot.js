// delta-robot.js
// 3D-ish Delta Robot BG — Catmull-Rom path + faux 6DOF wrist
(function () {
  // Cho phép tắt/bật bằng URL, nhưng mặc định là LUÔN cho phép motion
  const url = new URL(window.location.href);
  const forceAnim = url.searchParams.get("anim") !== "0";
  const reduce = false; // không dùng OS "reduce motion" nữa cho đỡ rắc rối

  function initDeltaBG() {
    const param = url.searchParams.get("delta");
    const allowMotion = forceAnim || !reduce;
    const enabled = (param === "1") || (allowMotion && param !== "0");

    const wrap = document.getElementById("delta-bg");
    if (!wrap) return;

    let canvas = document.getElementById("deltaCanvas");
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.id = "deltaCanvas";
      wrap.appendChild(canvas);
    }

    if (!enabled) {
      wrap.style.display = "none";
      return;
    }

    const hero = document.getElementById("hero");

    function sizeToHero() {
      const h = hero
        ? Math.max(420, hero.getBoundingClientRect().height)
        : 560;
      wrap.style.height = h + "px";
      const DPR = window.devicePixelRatio || 1;
      canvas.width = Math.floor(window.innerWidth * DPR);
      canvas.height = Math.floor(h * DPR);
    }

    sizeToHero();
    window.addEventListener("resize", sizeToHero);

    const ctx = canvas.getContext("2d");
    const DPR = window.devicePixelRatio || 1;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    let t = 0; // time

    // ==== tiny 3D helpers ====
    function rotX(p, a) {
      const s = Math.sin(a),
        c = Math.cos(a);
      return { x: p.x, y: p.y * c - p.z * s, z: p.y * s + p.z * c };
    }
    function rotY(p, a) {
      const s = Math.sin(a),
        c = Math.cos(a);
      return { x: p.x * c + p.z * s, y: p.y, z: -p.x * s + p.z * c };
    }
    function rotZ(p, a) {
      const s = Math.sin(a),
        c = Math.cos(a);
      return { x: p.x * c - p.y * s, y: p.x * s + p.y * c, z: p.z };
    }
    function applyR(p, rx, ry, rz) {
      return rotZ(rotY(rotX(p, rx), ry), rz);
    }
    function proj(p) {
      const f = 900; // focal length
      const z = p.z + 1100; // camera shift keeps z>0
      const k = f / (f + z);
      return {
        x: canvas.width / 2 + p.x * k,
        y: canvas.height * 0.55 - p.y * k,
        k,
      };
    }

    // ===== Scene params (bigger + closer) =====
    const Rb = 320; // base radius
    const Rp = 130; // platform radius
    const baseZ = -60; // raise toward camera
    const armColors = ["#7a86ff", "#8f6fff", "#5865F2"];

    const baseAnch = [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3].map((a) => ({
      x: Rb * Math.cos(a),
      y: Rb * Math.sin(a),
      z: baseZ,
    }));

    // Catmull–Rom key points (scaled by Rb)
    const P = [
      { x: 0, y: 0, z: -180 },
      { x: 0.7 * Rb, y: 0.1 * Rb, z: -160 },
      { x: 0.25 * Rb, y: 0.7 * Rb, z: -205 },
      { x: -0.6 * Rb, y: 0.05 * Rb, z: -170 },
      { x: -0.2 * Rb, y: -0.6 * Rb, z: -225 },
      { x: 0.6 * Rb, y: -0.4 * Rb, z: -190 },
    ];

    function catmullClosed(u) {
      const n = P.length;
      const s = u * n;
      const i = Math.floor(s) % n;
      const tt = s - Math.floor(s);
      const p0 = P[(i - 1 + n) % n],
        p1 = P[i],
        p2 = P[(i + 1) % n],
        p3 = P[(i + 2) % n];

      function cr(a, b, c, d, t) {
        const t2 = t * t,
          t3 = t2 * t;
        return (
          0.5 *
          ((2 * b) +
            (-a + c) * t +
            (2 * a - 5 * b + 4 * c - d) * t2 +
            (-a + 3 * b - 3 * c + d) * t3)
        );
      }

      return {
        x: cr(p0.x, p1.x, p2.x, p3.x, tt),
        y: cr(p0.y, p1.y, p2.y, p3.y, tt),
        z: cr(p0.z, p1.z, p2.z, p3.z, tt),
      };
    }

    // ===== HUD grid =====
    const GRID = { size: 1100, step: 100, z: baseZ + 260 };

    function drawGrid() {
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      ctx.lineWidth = 1 * DPR;

      for (let x = -GRID.size; x <= GRID.size; x += GRID.step) {
        const p1 = proj({ x, y: -GRID.size, z: GRID.z });
        const p2 = proj({ x, y: GRID.size, z: GRID.z });
        const fade = 0.06 + 0.12 * (1 - Math.abs(x) / GRID.size);
        ctx.strokeStyle = `rgba(88,101,242,${fade.toFixed(3)})`;
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
      }
      for (let y = -GRID.size; y <= GRID.size; y += GRID.step) {
        const p1 = proj({ x: -GRID.size, y, z: GRID.z });
        const p2 = proj({ x: GRID.size, y, z: GRID.z });
        const fade = 0.06 + 0.12 * (1 - Math.abs(y) / GRID.size);
        ctx.strokeStyle = `rgba(122,92,255,${fade.toFixed(3)})`;
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
      }
      ctx.restore();
    }

    function drawRing(cx, cy, cz, r, rot) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const seg = 80;
      ctx.beginPath();
      for (let i = 0; i <= seg; i++) {
        const a = rot + (i / seg) * Math.PI * 2;
        const p = proj({
          x: cx + r * Math.cos(a),
          y: cy + r * Math.sin(a),
          z: cz,
        });
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      ctx.strokeStyle = "rgba(138,148,255,0.35)";
      ctx.lineWidth = 1.5 * DPR;
      ctx.stroke();

      for (let k = 0; k < 24; k++) {
        const a = rot + (k / 24) * Math.PI * 2;
        const p1 = proj({
          x: cx + (r - 8) * Math.cos(a),
          y: cy + (r - 8) * Math.sin(a),
          z: cz,
        });
        const p2 = proj({
          x: cx + (r + 10) * Math.cos(a),
          y: cy + (r + 10) * Math.sin(a),
          z: cz,
        });
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.strokeStyle = "rgba(93,107,124,0.35)";
        ctx.lineWidth = 1 * DPR;
        ctx.stroke();
      }
      ctx.restore();
    }

    const trail = [];
    const TRAIL_MAX = 260;
    const sparks = Array.from({ length: 40 }, () => ({
      x: canvas.width / 2,
      y: canvas.height / 2,
      life: Math.random() * 1,
    }));

    function draw() {
      t += 0.01; // speed
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // HUD items
      drawGrid();
      drawRing(0, 0, baseZ + 20, Rb + 60, t * 0.6);
      drawRing(0, 0, baseZ + 20, Rb + 100, -t * 0.35);

      // EE pose along Catmull–Rom path
      const ee = catmullClosed((t * 0.12) % 1);
      const roll = Math.sin(t * 1.8) * 0.25;
      const pitch = Math.cos(t * 1.3) * 0.22;
      const yaw = Math.sin(t * 0.9 + 0.6) * 0.35;

      // Platform vertices local & world
      const platLocal = [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3].map((a) => ({
        x: Rp * Math.cos(a),
        y: Rp * Math.sin(a),
        z: 0,
      }));
      const platWorld = platLocal.map((p) => {
        const r = applyR(p, roll, pitch, yaw);
        return { x: r.x + ee.x, y: r.y + ee.y, z: r.z + ee.z };
      });

      const projEE = proj(ee);
      trail.push({ x: projEE.x, y: projEE.y });
      if (trail.length > TRAIL_MAX) trail.shift();

      // Trail glow
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.beginPath();
      for (let i = 0; i < trail.length; i++) {
        const p = trail[i];
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      const grad = ctx.createLinearGradient(0, 0, canvas.width, 0);
      grad.addColorStop(0, "rgba(88,101,242,0.12)");
      grad.addColorStop(0.5, "rgba(122,92,255,0.28)");
      grad.addColorStop(1, "rgba(122,92,255,0.08)");
      ctx.strokeStyle = grad;
      ctx.lineWidth = 3.2 * DPR;
      ctx.stroke();
      ctx.restore();

      // Base triangle
      ctx.beginPath();
      baseAnch.forEach((b, i) => {
        const bp = proj(b);
        if (i === 0) ctx.moveTo(bp.x, bp.y);
        else ctx.lineTo(bp.x, bp.y);
      });
      const bp0 = proj(baseAnch[0]);
      ctx.lineTo(bp0.x, bp0.y);
      ctx.strokeStyle = "rgba(88,101,242,0.30)";
      ctx.lineWidth = 1.6 * DPR;
      ctx.stroke();

      // Arms (two-pass: glow + crisp)
      platWorld.forEach((p, i) => {
        const b = baseAnch[i];
        const vx = p.x - b.x,
          vy = p.y - b.y,
          vz = p.z - b.z;
        const mid = {
          x: b.x + vx * 0.55,
          y: b.y + vy * 0.55,
          z: b.z + vz * 0.55,
        };
        const nx = -vy,
          ny = vx,
          nz = 0;
        const mag = Math.max(1, Math.hypot(nx, ny));
        const off = 30 + 9 * Math.sin(t * 2 + i * 1.8);
        const elbow = {
          x: mid.x + (nx / mag) * off,
          y: mid.y + (ny / mag) * off,
          z: mid.z + nz,
        };

        const b2 = proj(b),
          e2 = proj(elbow),
          p2 = proj(p);
        const col = armColors[i % armColors.length];

        // glow pass
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.shadowColor = "rgba(122,92,255,0.55)";
        ctx.shadowBlur = 14 * DPR;
        ctx.strokeStyle = col;
        ctx.lineWidth = 3.6 * DPR;
        ctx.beginPath();
        ctx.moveTo(b2.x, b2.y);
        ctx.lineTo(e2.x, e2.y);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(e2.x, e2.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
        ctx.restore();

        // crisp pass
        ctx.beginPath();
        ctx.moveTo(b2.x, b2.y);
        ctx.lineTo(e2.x, e2.y);
        ctx.strokeStyle = col;
        ctx.lineWidth = 2.2 * DPR;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(e2.x, e2.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.lineWidth = 2.0 * DPR;
        ctx.stroke();

        // joint dots with subtle glow
        function glowDot(pt, r, core, glow) {
          ctx.save();
          ctx.globalCompositeOperation = "lighter";
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, r * 1.8 * DPR, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(138,148,255,${glow})`;
          ctx.fill();
          ctx.restore();

          ctx.beginPath();
          ctx.arc(pt.x, pt.y, r * DPR, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(10,15,30,${core})`;
          ctx.fill();
        }

        glowDot(b2, 3, 0.28, 0.22);
        glowDot(e2, 2.8, 0.3, 0.24);
        glowDot(p2, 2.6, 0.3, 0.26);
      });

      // Platform outline
      ctx.beginPath();
      platWorld.forEach((pw, i) => {
        const pp = proj(pw);
        if (i === 0) ctx.moveTo(pp.x, pp.y);
        else ctx.lineTo(pp.x, pp.y);
      });
      ctx.closePath();
      ctx.strokeStyle = "rgba(15,22,40,0.6)";
      ctx.lineWidth = 1.6 * DPR;
      ctx.stroke();
      ctx.fillStyle = "rgba(88,101,242,0.08)";
      ctx.fill();

      // End-effector reticle + dot
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.lineWidth = 1 * DPR;
      ctx.strokeStyle = "rgba(138,148,255,0.6)";
      ctx.beginPath();
      ctx.moveTo(projEE.x - 10 * DPR, projEE.y);
      ctx.lineTo(projEE.x + 10 * DPR, projEE.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(projEE.x, projEE.y - 10 * DPR);
      ctx.lineTo(projEE.x, projEE.y + 10 * DPR);
      ctx.stroke();
      ctx.restore();

      ctx.beginPath();
      ctx.arc(projEE.x, projEE.y, 4.2 * DPR, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(122,92,255,0.95)";
      ctx.fill();

      // Spark particles gravitating to EE
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (const s of sparks) {
        s.x += (projEE.x - s.x) * 0.08 + (Math.random() - 0.5) * 1.2;
        s.y += (projEE.y - s.y) * 0.08 + (Math.random() - 0.5) * 1.2;
        s.life += 0.02;
        const r = 0.8 * DPR + 0.6 * Math.sin(s.life * 8 + s.x * 0.01);
        ctx.beginPath();
        ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(138,148,255,0.35)";
        ctx.fill();
      }
      ctx.restore();

      requestAnimationFrame(draw);
    }

    requestAnimationFrame(draw);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initDeltaBG);
  } else {
    initDeltaBG();
  }
})();
