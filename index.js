const SNAKE_MIN_DISTANCE = 80;
const SNAKE_DISTANCE_LINE_WIDTH = 5;
const SNAKE_LINE_WIDTH = 1;
const LEVEL_UPGRADE_COST_RATIO = 2;
const LEVEL_MAX = 3;
const IMG_BASE_SIZE = 48;


// ==============================
// シード付き乱数生成器
// ==============================
function SeededRandom(seed) {
    this.seed = seed % 2147483647;
    if (this.seed <= 0) this.seed += 2147483646;
}

SeededRandom.prototype.next = function () {
    // 線形合同法
    this.seed = (this.seed * 16807) % 2147483647;
    return (this.seed - 1) / 2147483646;
};


// =====================
// 基本設定
// =====================
const rng = new SeededRandom(114114); // 12345 がシード値

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
ctx.lineWidth = SNAKE_LINE_WIDTH;

const FPS = 60;
const FRAME_TIME = 1000 / FPS;

let frame = 0;        // ロジック用フレーム
let second = 0;       // 実時間（表示用）
let cost = 10;
let gameOver = false;

let speedMultiplier = 1; // x1, x2, x3
function setSpeed(v) {
    speedMultiplier = v;
    document.getElementById("speed").textContent = "x" + speedMultiplier;

}

let enemiesDefeated = 0;


let lastTime = performance.now();
let accumulator = 0;

let draggingType = null;
let selected = null;

let isInteracting = false;


const record = []; // 棋譜


// =====================
// 画像
// =====================
const IMAGE_DEFS = {
    "snake.normal": "imgs/snake(normal).png",
    "snake.producer": "imgs/snake(producer).png",
    "snake.stone": "imgs/snake(stone).png",
    "horse.normal": "imgs/horse(normal).png",
};
const ImageManager = {
    images: {},
    loaded: 0,
    total: 0,

    loadAll(callback) {
        this.total = Object.keys(IMAGE_DEFS).length;

        Object.entries(IMAGE_DEFS).forEach(([key, src]) => {
            const img = new Image();
            img.src = src;

            img.onload = () => {
                this.loaded++;
                if (this.loaded === this.total) {
                    callback();
                }
            };

            this.images[key] = img;
        });
    },

    get(key) {
        return this.images[key];
    }
};


// =====================
// ゲームデータ
// =====================
const lanes = [60, 180, 300];
const defenseLine = canvas.height - 40;

const snakes = [];
const enemies = [];
const effects = [];
const costEffects = []; // お金増加エフェクト用


const enemyTypes = {
    normal: { imgKey: "horse.normal", desc: "普通の馬", baseHp: 10, baseSpeed: 0.1 },
    fast: { imgKey: "horse.normal", desc: "速い馬", baseHp: 7, baseSpeed: 0.2 },
    tank: { imgKey: "horse.normal", desc: "タンク馬", baseHp: 25, baseSpeed: 0.05 },
};

const snakeTypes = {
    normal: {
        cost: 7,
        rate: FPS,
        dmg: 1,
        range: 80,
        imgKey: "snake.normal",
        desc: "毎秒ダメージを与える",
    },
    producer: {
        cost: 7,
        rate: FPS,
        produceSec: 5,
        produceAmmount: 1,
        range: 0,
        imgKey: "snake.producer",
        desc: "所持金を回復する",
    },
    stone: {
        cost: 7,
        rate: FPS / 5,
        slow: 0.5,     // 40%速度
        slowTime: 120, // 2秒
        range: 60,
        imgKey: "snake.stone",
        desc: "敵のスピードを落とす",
    }
};

function getEnemyStats(h) {
    const t = horseTypes[h.type];
    return t;
}

function getSnakeStats(s) {
    const t = snakeTypes[s.type];
    const lv = s.level;
    let status = {
        id: t.id,
        cost: t.cost,
        desc: t.desc,
        level: s.level > 0 ? s.level : 1,
        color: t.color,
        imgKey: t.imgKey,
        rate: t.rate,
    };
    if (t.dmg) status.dmg = t.dmg + (lv - 1) + 0.5;
    if (t.range) status.range = t.range + (lv - 1) * 20;
    if (t.slow) status.slow = t.slow - (lv - 1) * 0.1;
    if (t.slowTime) status.slowTime = t.slowTime;
    if (t.produceSec) status.produceSec = t.produceSec - (lv - 1) * 1;
    if (t.produceAmmount) status.produceAmmount = t.produceAmmount;

    return status;
}


// =====================
// UI操作
// =====================
document.querySelectorAll("button").forEach(btn => {
    btn.addEventListener("dragstart", () => draggingType = btn.dataset.type);
    btn.addEventListener("touchstart", () => draggingType = btn.dataset.type);

    //interaction
    btn.addEventListener("dragstart", () => {
        draggingType = btn.dataset.type;
        isInteracting = true;
    });
    btn.addEventListener("touchstart", () => {
        draggingType = btn.dataset.type;
        isInteracting = true;
    });


});

canvas.addEventListener("dragover", e => e.preventDefault());

canvas.addEventListener("drop", e => {
    const r = canvas.getBoundingClientRect();
    placeSnake(e.clientX - r.left, e.clientY - r.top);
});

canvas.addEventListener("touchend", e => {
    isInteracting = false; draggingType = null;
    const t = e.changedTouches[0];
    const r = canvas.getBoundingClientRect();
    placeSnake(t.clientX - r.left, t.clientY - r.top);
});

canvas.addEventListener("click", e => {
    isInteracting = false; draggingType = null;
    if (draggingType) return;
    const r = canvas.getBoundingClientRect();

    const x = e.clientX - r.left;
    const y = e.clientY - r.top;

    // 強化ボタン判定
    if (selected && selected.kind === "snake") {
        const b = selected.data._upgradeBtn;
        if (b &&
            x > b.x && x < b.x + b.w &&
            y > b.y && y < b.y + b.h &&
            b.level < LEVEL_MAX &&
            cost >= b.cost) {
            cost -= b.cost;
            selected.data.level++;

            record.push({
                action: "upgradeSnake",
                id: selected.data.id,
                type: selected.data.type,
                level: selected.data.level,
                frame: frame,
            });
            return;
        }
    }


    selectEntity(x, y);
});


// ====================
// おける範囲の限定
// ====================
let previewPos = null;

canvas.addEventListener("mousemove", e => {
    if (!draggingType) return;
    const r = canvas.getBoundingClientRect();
    previewPos = { x: e.clientX - r.left, y: e.clientY - r.top };
});

canvas.addEventListener("touchmove", e => {
    if (!draggingType) return;
    const t = e.touches[0];
    const r = canvas.getBoundingClientRect();
    previewPos = { x: t.clientX - r.left, y: t.clientY - r.top };
});


function canPlaceSnake(x, y) {
    // 防衛ライン・UIエリア制限
    //if (y < 80 || y > defenseLine) return false;

    // 他の蛇との距離制限
    for (const s of snakes) {
        const d = Math.hypot(x - s.x, y - s.y);
        if (d < SNAKE_MIN_DISTANCE) return false;
    }

    return true;
}


function placeSnake(x, y) {
    if (!draggingType) return;

    const t = snakeTypes[draggingType];
    if (cost < t.cost) return;
    if (!canPlaceSnake(x, y)) return;

    cost -= t.cost;

    const snakeData = {
        id: snakes.length + 1,
        x,
        y,
        type: draggingType,
        level: 1,
        frame: frame // 何フレーム目に置いたかも記録
    };
    snakes.push({ ...snakeData, timer: 0 });
    record.push({ action: "placeSnake", ...snakeData }); // 棋譜に追加

    draggingType = null;
    previewPos = null;
    isInteracting = false;


    draggingType = null;
    previewPos = null;
    isInteracting = false;
}

function selectEntity(x, y) {
    selected = null;
    snakes.forEach(s => {
        if (Math.hypot(x - s.x, y - s.y) < 10) selected = { kind: "snake", data: s };
    });
    enemies.forEach(e => {
        if (Math.hypot(x - e.x, y - e.y) < 12) selected = { kind: "enemy", data: e };
    });
}

function getEntitySize(baseSize, level = 1) {
    return baseSize + (level - 1) * 16;
}



// =====================
// 敵生成
// =====================
function spawnEnemy() {
    const hp = 10 * (1 + 1 * parseInt(frame / (FPS * 30)));
    const speed = 0.10 * (1 + 1 * parseInt(frame / (FPS * 30)))
    enemies.push({
        x: lanes[Math.floor(rng.next() * lanes.length)],
        y: -20,
        hp: hp,
        maxHp: hp,
        speed: speed,
        slow: 1,
        slowTimer: 0,
        poison: 0
    });
}

// =====================
// ロジック更新（固定FPS）
// =====================
function updateLogic() {
    if (gameOver) return;
    if (selected || isInteracting) return;

    frame++;

    if (frame % FPS === 0) {
        second++;
        cost++;
    }

    const spawnInterval = Math.max(120 - frame / 30, 50);
    if (frame % spawnInterval === 0) {
        spawnEnemy();
    }

    // 蛇
    snakes.forEach(s => {
        s.timer++;
        const t = getSnakeStats(s);

        if (
            (t.produceSec)
            &&
            (s.timer % (t.produceSec * FPS) === 0)
        ) {
            cost++;
            costEffects.push({ x: s.x, y: s.y - 20, text: `+${t.produceAmmount}`, life: 30 });
        }

        enemies.forEach(e => {
            const d = Math.hypot(e.x - s.x, e.y - s.y);
            if (d < t.range && t.rate && s.timer % t.rate === 0) {
                e.hp -= t.dmg || 0;
                if (t.poison) e.poison += t.poison;
                //if (t.stun) e.stun = t.stun;
                if (t.slow) {
                    e.slow = t.slow;
                    e.slowTimer = t.slowTime;
                }

                if (t.dmg && t.dmg > 0) {
                    effects.push({ x: e.x, y: e.y, text: `-${t.dmg || 0}`, life: 30 });
                }
            }
        });
    });

    // 敵
    enemies.forEach(e => {
        //if (e.stun > 0) { e.stun--; return; }
        if (e.slowTimer > 0) {
            e.slowTimer--;
        } else {
            e.slow = 1;
        }
        e.y += e.speed * e.slow;
        e.hp -= e.poison;
        if (e.y > defenseLine) {
            gameOver = true;

            showRankingUI();
        }
    });

    for (let i = enemies.length - 1; i >= 0; i--) {
        if (enemies[i].hp <= 0) {
            enemies.splice(i, 1);
            enemiesDefeated++;
        }
    }

    // エフェクト
    for (let i = effects.length - 1; i >= 0; i--) {
        effects[i].y -= 0.5;
        effects[i].life--;
        if (effects[i].life <= 0) effects.splice(i, 1);
    }
}

// ステータス表示
const STATUS_X = 180;
const STATUS_Y = 10;
const STATUS_W = 170;
const STATUS_H = 110;
function drawEnemyStatus(e) {
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.fillRect(STATUS_X, STATUS_Y, STATUS_W, STATUS_H);

    ctx.fillStyle = "#fff";
    ctx.fillText("【馬】", STATUS_X + 10, STATUS_Y + 20);
    ctx.fillText(`HP: ${Math.ceil(e.hp)} / ${Math.ceil(e.maxHp)}`, STATUS_X + 10, STATUS_Y + 40);
    ctx.fillText(`速度: ${(e.baseSpeed * e.slow).toFixed(2)}`, STATUS_X + 10, STATUS_Y + 60);
    ctx.fillText(`毒: ${e.poison.toFixed(2)}`, STATUS_X + 10, STATUS_Y + 80);
}
function drawSnakeStatus(s) {
    const t = getSnakeStats(s);

    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.fillRect(STATUS_X, STATUS_Y, STATUS_W, STATUS_H);

    ctx.fillStyle = "#fff";
    let label = "【蛇】";
    if (s.type === "normal") label += "通常 ";
    if (s.type === "procedure") label += "生産 ";
    if (s.type === "stone") label += "石化 ";
    label += "lv " + t.level;
    ctx.fillText(label, STATUS_X + 10, STATUS_Y + 20);
    //ctx.fillText(`種類: ${s.type}`, STATUS_X + 10, STATUS_Y + 40);
    ctx.fillText(`射程: ${t.range ?? 0}`, STATUS_X + 10, STATUS_Y + 40);
    if (t.dmg) ctx.fillText(`ダメージ: ${t.dmg}`, STATUS_X + 10, STATUS_Y + 60);
    if (t.produceSec && t.produceAmmount) ctx.fillText(`生産量: ${t.produceAmmount} / ${t.produceSec}s`, STATUS_X + 10, STATUS_Y + 60);
    if (t.slow) ctx.fillText(`減速: ${t.slow}倍`, STATUS_X + 10, STATUS_Y + 60);
    ctx.fillText(`説明: ${t.desc}`, STATUS_X + 10, STATUS_Y + 80);

    // ボタン
    const upCost = LEVEL_UPGRADE_COST_RATIO * t.level * t.cost;
    ctx.fillText(t.level < LEVEL_MAX ? `強化コスト: ${upCost}` : "強化コスト: -", STATUS_X + 10, STATUS_Y + 100);
    ctx.fillStyle = ((cost >= upCost) && (t.level < LEVEL_MAX)) ? "#0f0" : "#555";
    ctx.fillRect(STATUS_X + 20, STATUS_Y + 110, 130, 25);
    ctx.fillStyle = "#000";
    ctx.fillText(t.level < LEVEL_MAX ? "強化する" : "LV MAX", STATUS_X + 45, STATUS_Y + 128);

    // ボタン判定を保存
    s._upgradeBtn = {
        x: STATUS_X + 20,
        y: STATUS_Y + 110,
        w: 130,
        h: 25,
        cost: upCost,
        level: t.level,
    };
}



// =====================
// 描画
// =====================
function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    //置けるかどうかの判定
    /*
    // プレビュー表示
    if (draggingType && previewPos) {
        const ok = canPlaceSnake(previewPos.x, previewPos.y);
        ctx.fillStyle = ok ? "rgba(0,255,0,0.3)" : "rgba(255,0,0,0.3)";
        ctx.beginPath();
        ctx.arc(previewPos.x, previewPos.y, 10, 0, Math.PI * 2);
        ctx.fill();
        // 最小距離円
        ctx.strokeStyle = "rgba(255,255,255,0.2)";
        ctx.beginPath();
        ctx.arc(previewPos.x, previewPos.y, SNAKE_MIN_DISTANCE, 0, Math.PI * 2);
        ctx.stroke();
    }
    */


    // レーン
    ctx.strokeStyle = "#333";
    lanes.forEach(x => {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
    });

    // 防衛ライン
    ctx.strokeStyle = "red";
    ctx.beginPath();
    ctx.moveTo(0, defenseLine);
    ctx.lineTo(canvas.width, defenseLine);
    ctx.stroke();

    // 蛇
    snakes.forEach(s => {
        const t = getSnakeStats(s);

        // 攻撃範囲
        ctx.fillStyle = "rgba(0,255,0,0.08)";
        ctx.beginPath();
        ctx.arc(s.x, s.y, t.range, 0, Math.PI * 2);
        ctx.fill();
        //接触範囲
        ctx.lineWidth = SNAKE_DISTANCE_LINE_WIDTH;
        ctx.strokeStyle = "rgba(255,0,0,0.15)";
        ctx.beginPath();
        ctx.arc(s.x, s.y, SNAKE_MIN_DISTANCE, 0, Math.PI * 2);
        //ctx.lineWidth = 1.0;
        ctx.stroke();
        ctx.lineWidth = SNAKE_LINE_WIDTH;
        //体
        //ctx.fillStyle = "green";
        //ctx.fillRect(s.x - 8, s.y - 8, 16, 16);
        const img = ImageManager.get(t.imgKey);
        const size = getEntitySize(IMG_BASE_SIZE, t.level);
        ctx.drawImage(
            img,
            s.x - size / 2,
            s.y - size / 2,
            size,
            size
        );

        if (img.complete) {
            ctx.drawImage(
                img,
                s.x - size / 2,
                s.y - size / 2,
                size,
                size
            );
        }
    });

    // 敵＋HPバー
    enemies.forEach(e => {
        const img = ImageManager.get(enemyTypes.normal.imgKey);
        const size = IMG_BASE_SIZE;
        ctx.drawImage(
            img,
            e.x - size / 2,
            e.y - size / 2,
            size,
            size
        );

        // 石化・減速の視覚化
        if (e.slow < 1) {
            ctx.fillStyle = "rgba(67, 82, 85, 0.5)";
            ctx.beginPath();
            ctx.arc(e.x, e.y, size / 2, 0, Math.PI * 2);
            ctx.fill();
        }



        // HPバー描画
        const barWidth = 40;   // 幅を広げる
        const barHeight = 6;   // 高さを太く
        const barX = e.x - barWidth / 2;
        const barY = e.y - size / 2 - 10;

        // 背景バー
        ctx.fillStyle = "#555";
        ctx.fillRect(barX, barY, barWidth, barHeight);

        // 現在HP
        const hpRatio = Math.max(e.hp / e.maxHp, 0);
        let hpColor = "lime"; // 緑色が基本
        if (hpRatio < 0.5) hpColor = "orange";
        if (hpRatio < 0.25) hpColor = "red";
        ctx.fillStyle = hpColor;
        ctx.fillRect(barX, barY, barWidth * hpRatio, barHeight);

        // 枠線
        ctx.strokeStyle = "#000";
        ctx.lineWidth = 1;
        ctx.strokeRect(barX, barY, barWidth, barHeight);
    });

    // ダメージ
    effects.forEach(f => {
        ctx.fillStyle = `rgba(255,255,255,${f.life / 30})`;
        ctx.fillText(f.text, f.x, f.y);
    });

    // 所持金増加エフェクト描画
    costEffects.forEach((f, i) => {
        ctx.fillStyle = `rgba(0,255,0,${f.life / 30})`;
        ctx.font = "16px sans-serif";
        ctx.fillText(f.text, f.x, f.y);
        f.y -= 0.5; // 上に浮かせる
        f.life--;
        if (f.life <= 0) costEffects.splice(i, 1);
    });


    // ステータス
    if (selected) {
        if (selected.kind === "enemy") {
            drawEnemyStatus(selected.data);
        } else {
            drawSnakeStatus(selected.data);
        }
    }



    document.getElementById("cost").textContent = cost;
    document.getElementById("time").textContent = second;

    if (isInteracting && !gameOver) {
        ctx.fillStyle = "rgba(0,0,0,0.3)";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.fillStyle = "#fff";
        ctx.fillText("一時停止中", 130, 280);
    }

    updateScoreUI();

    if (gameOver) {
        ctx.fillStyle = "#fff";
        ctx.fillText(`敗北 生存 ${second} 秒`, 90, 300);
    }
}

// =====================
// ゲームループ
// =====================
function gameLoop(now) {
    const delta = now - lastTime;
    lastTime = now;
    accumulator += delta;

    while (accumulator >= FRAME_TIME) {
        for (let i = 0; i < speedMultiplier; i++) {
            updateLogic();
        }
        accumulator -= FRAME_TIME;
    }

    draw();
    requestAnimationFrame(gameLoop);
}

ImageManager.loadAll(() => {
    requestAnimationFrame(gameLoop);
});
//requestAnimationFrame(gameLoop);

// =====================
// ランキングUI制御
// =====================
const rankingUI = document.getElementById("ranking-ui");
const finalScoreEl = document.getElementById("final-score");
const nameInput = document.getElementById("player-name-input");
const submitBtn = document.getElementById("submit-score-btn");
const rankingResult = document.getElementById("ranking-result");

let scoreSent = false;

function calculateScore() {
    const snakeScore = snakes.length * 10;      // 設置したヘビ1体につき10点
    const enemyScore = enemiesDefeated * 5;    // 倒した敵1体につき5点
    const costScore = cost;                     // 所持コスト
    const timeScore = second;                   // 生存時間も加点

    const total = snakeScore + enemyScore + costScore + timeScore;

    return { total, snakeScore, enemyScore, costScore, timeScore };
}

function updateScoreUI() {
    const score = calculateScore();
    document.getElementById("score-total").textContent = `合計スコア: ${score.total}`;
    document.getElementById("score-snakes").textContent = `蛇スコア: ${score.snakeScore}`;
    document.getElementById("score-enemies").textContent = `敵撃破: ${score.enemyScore}`;
    document.getElementById("score-cost").textContent = `コスト: ${score.costScore}`;
    document.getElementById("score-time").textContent = `生存時間: ${score.timeScore}`;
}

function showRankingUI() {
    updateScoreUI();
    finalScoreEl.textContent = calculateScore().total;
    rankingUI.style.display = "block";
    fetchRanking();
}

submitBtn.onclick = () => {
    const name = nameInput.value.trim();
    const comment = document.getElementById("player-comment-input").value.trim(); // コメント取得

    if (!name) {
        alert("名前を入力してください");
        return;
    }
    if (scoreSent) return;
    scoreSent = true;

    submitBtn.disabled = true;
    submitBtn.textContent = "送信中...";

    const params = new URLSearchParams();
    params.append("name", name);
    params.append("score", calculateScore().total);
    params.append("comment", comment); // ←コメントを追加
    params.append("apiKey", API_KEY);
    params.append("record", JSON.stringify(record));

    fetch(RANKING_API_URL, {
        method: "POST",
        body: params
    })
        .then(res => res.json())
        .then(() => {
            fetchRanking();
            submitBtn.textContent = "送信完了";
        })
        .catch(err => {
            console.error(err);
            submitBtn.textContent = "送信失敗";
        });
};

function fetchRanking() {
    fetch(RANKING_API_URL)
        .then(res => res.json())
        .then(data => {
            renderRanking(data);
        });
}

function renderRanking(list) {
    rankingResult.innerHTML = "<h3>ランキング</h3>";
    list.slice(0, 10).forEach((r, i) => {
        const row = document.createElement("div");
        row.textContent = `${i + 1}. ${r.name} : ${r.score}`;
        if (r.comment) row.textContent += ` - "${r.comment}"`; // コメント表示
        rankingResult.appendChild(row);
    });
}
