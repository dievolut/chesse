const boardEl = document.getElementById('board');
const statusEl = document.getElementById('status');
const movesEl = document.getElementById('moves');
const resetBtn = document.getElementById('reset');
const roomLinkInput = document.getElementById('room-link');
const copyBtn = document.getElementById('copy-link');
const joinBtn = document.getElementById('join-room');
const roomNameInput = document.getElementById('room-name');

const PIECES = {
  wp: '♙', wn: '♘', wb: '♗', wr: '♖', wq: '♕', wk: '♔',
  bp: '♟', bn: '♞', bb: '♝', br: '♜', bq: '♛', bk: '♚'
};

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1'];

let chess = new Chess();
let selectedSquare = null;
let legalTargets = [];
let myRole = 'spectator';
let userId = localStorage.getItem('chess_user_id') || null;
let currentRoom = getRoomFromUrl();
let eventStream = null;

function getRoomFromUrl() {
  const hash = window.location.hash.replace('#', '').trim();
  return (hash || 'lobby').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32) || 'lobby';
}

function updateLink() {
  const url = `${window.location.origin}${window.location.pathname}#${currentRoom}`;
  roomLinkInput.value = url;
  roomNameInput.value = currentRoom;
}

async function postJson(url, data) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.message || 'Error de red');
  }

  return payload;
}

async function joinRoom() {
  const state = await postJson('/api/join', { roomId: currentRoom, userId });
  userId = state.userId;
  localStorage.setItem('chess_user_id', userId);
  myRole = state.yourRole;
  applyState(state);
  watchEvents();
}

function watchEvents() {
  if (eventStream) {
    eventStream.close();
  }

  eventStream = new EventSource(`/api/events?room=${encodeURIComponent(currentRoom)}`);
  eventStream.onmessage = (event) => {
    const state = JSON.parse(event.data);
    applyState(state);
  };

  eventStream.onerror = () => {
    statusEl.textContent = 'Conexión inestable. Reintentando...';
  };
}

function getResultText() {
  if (!chess.isGameOver()) return null;
  if (chess.isCheckmate()) return `Jaque mate. Ganan ${chess.turn() === 'w' ? 'negras' : 'blancas'}.`;
  if (chess.isStalemate()) return 'Ahogado.';
  if (chess.isThreefoldRepetition()) return 'Tablas por repetición.';
  if (chess.isInsufficientMaterial()) return 'Tablas por material insuficiente.';
  if (chess.isDraw()) return 'Tablas.';
  return 'Partida finalizada.';
}

function applyState(state) {
  chess.load(state.fen);
  selectedSquare = null;
  legalTargets = [];
  renderBoard();
  renderMoves(state.history || []);
  updateStatus(state);
}

function updateStatus(state) {
  const roleText = myRole === 'w' ? 'blancas' : myRole === 'b' ? 'negras' : 'espectador';
  const turnText = chess.turn() === 'w' ? 'blancas' : 'negras';

  if (state.isGameOver) {
    statusEl.textContent = `${state.result || 'Partida finalizada.'} Tu rol: ${roleText}.`;
    return;
  }

  const check = state.isCheck ? ' Jaque.' : '';
  statusEl.textContent = `Turno de ${turnText}.${check} Tu rol: ${roleText}.`;
}

function renderMoves(history) {
  movesEl.innerHTML = '';
  history.forEach((move, i) => {
    const li = document.createElement('li');
    li.textContent = `${i + 1}. ${move}`;
    movesEl.appendChild(li);
  });
}

function renderBoard() {
  boardEl.innerHTML = '';

  for (const rank of RANKS) {
    for (const file of FILES) {
      const sq = `${file}${rank}`;
      const isLight = (FILES.indexOf(file) + RANKS.indexOf(rank)) % 2 === 0;
      const piece = chess.get(sq);

      const div = document.createElement('button');
      div.className = `square ${isLight ? 'light' : 'dark'}`;
      div.dataset.square = sq;

      if (selectedSquare === sq) div.classList.add('selected');
      if (legalTargets.includes(sq)) div.classList.add('legal');

      if (piece) div.textContent = PIECES[`${piece.color}${piece.type}`];

      div.addEventListener('click', onSquareClick);
      boardEl.appendChild(div);
    }
  }
}

async function onSquareClick(event) {
  const sq = event.currentTarget.dataset.square;
  const piece = chess.get(sq);
  const myTurn = chess.turn() === myRole;

  if (!myTurn || chess.isGameOver()) return;

  if (selectedSquare && legalTargets.includes(sq)) {
    const move = chess.move({ from: selectedSquare, to: sq, promotion: 'q' });

    if (move) {
      try {
        await postJson('/api/move', {
          roomId: currentRoom,
          userId,
          turn: move.color,
          nextTurn: chess.turn(),
          fen: chess.fen(),
          history: chess.history(),
          isGameOver: chess.isGameOver(),
          isCheck: chess.isCheck(),
          result: getResultText()
        });
      } catch (error) {
        statusEl.textContent = error.message;
      }
    }

    selectedSquare = null;
    legalTargets = [];
    renderBoard();
    return;
  }

  if (!piece || piece.color !== myRole) {
    selectedSquare = null;
    legalTargets = [];
    renderBoard();
    return;
  }

  selectedSquare = sq;
  legalTargets = chess.moves({ square: sq, verbose: true }).map((m) => m.to);
  renderBoard();
}

copyBtn.addEventListener('click', async () => {
  await navigator.clipboard.writeText(roomLinkInput.value);
  copyBtn.textContent = '¡Copiado!';
  setTimeout(() => { copyBtn.textContent = 'Copiar'; }, 1200);
});

joinBtn.addEventListener('click', async () => {
  const newRoom = roomNameInput.value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32);
  if (!newRoom) return;

  currentRoom = newRoom;
  window.location.hash = `#${currentRoom}`;
  updateLink();
  await joinRoom();
});

resetBtn.addEventListener('click', async () => {
  try {
    await postJson('/api/reset', { roomId: currentRoom, userId });
  } catch (error) {
    statusEl.textContent = error.message;
  }
});

window.addEventListener('hashchange', async () => {
  const room = getRoomFromUrl();
  if (room !== currentRoom) {
    currentRoom = room;
    updateLink();
    await joinRoom();
  }
});

updateLink();
renderBoard();
joinRoom();
