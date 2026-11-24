const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta name="theme-color" content="#080709"><link rel="icon" type="image/svg+xml" href="/favicon.svg?v=2"><title>Wetin Be Dis | Big Screen</title>
<style>
:root{color-scheme:dark;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#080709;color:#fff4d8;--ink:#080709;--paper:#fff4d8;--gold:#ffb100;--green:#18a640;--purple:#43127b}
*{box-sizing:border-box}
body{margin:0;min-height:100svh;background:radial-gradient(ellipse at 86% 4%,rgba(67,18,123,.5),transparent 38%),radial-gradient(ellipse at 8% 100%,rgba(24,166,64,.22),transparent 42%),#080709}
.shell{width:min(100%,1700px);height:100svh;min-height:0;margin:auto;padding:1.8vh 3vw;display:flex;flex-direction:column;gap:1.35vh;overflow:hidden}
.top{display:flex;align-items:center;gap:2vw}
.brand{font-size:clamp(14px,1.4vw,24px);font-weight:900;letter-spacing:.18em;color:#ffd65b}
.liveStatus{display:flex;align-items:center;gap:9px;margin-left:clamp(12px,2vw,30px);padding:8px 13px;border:1px solid rgba(24,166,64,.44);border-radius:999px;background:rgba(24,166,64,.12);color:#bdf6c8;font-size:clamp(10px,.9vw,14px);font-weight:900;letter-spacing:.1em;white-space:nowrap}
.liveDot{width:9px;height:9px;border-radius:50%;background:#18a640;box-shadow:0 0 12px rgba(24,166,64,.85)}
.team{margin-left:auto;font-size:clamp(22px,3vw,48px);font-weight:850}
.round{font-size:clamp(14px,1.2vw,20px);opacity:.78}
.timer{font-size:clamp(32px,4vw,64px);font-variant-numeric:tabular-nums;font-weight:900;color:#ffd65b;min-width:2.4em;text-align:right}
.track{height:9px;border-radius:20px;background:#ffffff22;overflow:hidden}
.fill{height:100%;width:0;background:linear-gradient(90deg,#ffb100,#18a640);transition:width .35s linear}
.grid{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1.65fr) minmax(250px,.8fr);gap:2vw}
.pregame{flex:1;min-height:0;display:grid;place-items:center;padding:clamp(20px,5vw,72px);border:1px solid rgba(255,177,0,.28);border-radius:30px;background:linear-gradient(145deg,rgba(67,18,123,.30),rgba(16,14,19,.92) 52%);text-align:center}
.pregameContent{width:min(100%,1000px)}
.pregameKicker{margin:0 0 clamp(16px,3vh,32px);color:#ffd65b;font-size:clamp(12px,1.3vw,20px);font-weight:950;letter-spacing:.2em}
.pregameTitle{margin:0;color:#fff4d8;font:700 clamp(38px,7vw,96px)/1 Georgia,serif}
.pregameCopy{max-width:760px;margin:clamp(14px,2vh,24px) auto 0;color:#d1cbd2;font-size:clamp(16px,2vw,28px);line-height:1.5}
.pregameCount{margin:clamp(10px,2vh,24px) 0 0;color:#ffd65b;font-size:clamp(92px,20vw,280px);font-weight:950;line-height:.9;font-variant-numeric:tabular-nums;text-shadow:0 10px 50px rgba(255,177,0,.18)}
.pregameCount.hidden{display:none}
.card,.forbidden{min-height:0;border-radius:28px;padding:clamp(18px,3vw,48px);display:flex;flex-direction:column;justify-content:center}
.card{background:#fff4d8;color:#101a15;border:5px solid #ffb100;box-shadow:0 18px 70px #0006}
.results{flex:1;min-height:0;display:grid;place-items:center}.resultsCard{width:min(100%,1180px);max-height:100%;overflow:auto;padding:clamp(24px,4vh,48px) clamp(24px,5vw,72px);border:5px solid #ffb100;border-radius:28px;background:#fff4d8;color:#101a15;box-shadow:0 18px 70px #0006;text-align:center}.resultsKicker{margin:0 0 12px;color:#236d45;font-size:clamp(12px,1.2vw,18px);font-weight:950;letter-spacing:.18em}.resultsTitle{margin:0 0 clamp(18px,3vh,32px);font:900 clamp(42px,7vw,100px)/.98 Georgia,serif;overflow-wrap:anywhere}.finalScores{display:flex;justify-content:center;align-items:stretch;gap:clamp(12px,2vw,24px);flex-wrap:wrap}.finalScore{min-width:min(240px,42vw);padding:clamp(16px,2.5vw,28px);border:2px solid rgba(8,7,9,.12);border-radius:20px;background:#fffdf5}.finalScore.winner{border-color:#18a640;background:rgba(24,166,64,.1)}.finalTeamName{font-size:clamp(17px,2vw,28px);font-weight:900}.finalTeamPoints{margin-top:8px;color:#236d45;font:900 clamp(32px,4.2vw,58px)/1 system-ui,sans-serif}.resultsReview{margin:clamp(18px,3vh,30px) auto 0;max-width:920px;text-align:left}.reviewHeading{display:flex;align-items:baseline;justify-content:space-between;gap:14px;margin-bottom:12px}.reviewHeading h2{margin:0;font-size:clamp(18px,1.8vw,26px)}.reviewHeading p{margin:0;color:#596056;font-size:clamp(11px,1vw,14px);font-weight:700}.reviewTabs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}.reviewTab{min-height:40px;padding:8px 16px;border:1px solid rgba(8,7,9,.16);border-radius:999px;background:#fffdf5;color:#101a15;font:800 clamp(12px,1.1vw,16px) system-ui,sans-serif;cursor:pointer}.reviewTab[aria-selected="true"]{border-color:#236d45;background:#236d45;color:#fff4d8}.reviewCards{display:grid;gap:8px;max-height:min(26vh,300px);overflow:auto;padding:2px 5px 2px 0;overscroll-behavior:contain}.reviewCard{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:2px 12px;align-items:center;padding:11px 14px;border:1px solid rgba(8,7,9,.1);border-radius:13px;background:#fffdf5}.reviewNumber{grid-row:span 2;color:#687168;font-size:12px;font-weight:900}.reviewAnswer{font-size:clamp(15px,1.45vw,20px);font-weight:900;overflow-wrap:anywhere}.reviewMeta{color:#596056;font-size:clamp(11px,1vw,14px);font-weight:650}.reviewOutcome{grid-column:3;grid-row:1 / span 2;padding:5px 8px;border-radius:999px;background:rgba(35,109,69,.1);color:#236d45;font-size:clamp(9px,.8vw,12px);font-weight:950;text-transform:uppercase;white-space:nowrap}.reviewEmpty{margin:0;padding:16px;border-radius:12px;background:#fffdf5;color:#596056;font-weight:700}.resultsNote{margin:20px 0 0;color:#596056;font-size:clamp(13px,1.2vw,18px);font-weight:700}.cardState{margin-bottom:clamp(10px,2vh,22px);font-size:clamp(11px,1.05vw,16px);font-weight:950;letter-spacing:.16em;color:#236d45}
.category{font-size:clamp(16px,1.5vw,24px);font-weight:900;letter-spacing:.17em;text-transform:uppercase;color:#236d45}
.answer{font-family:Georgia,serif;font-size:clamp(42px,min(8.5vw,15vh),140px);line-height:.98;font-weight:900;margin:.12em 0 .2em;overflow-wrap:anywhere}
.difficulty{font-size:clamp(16px,1.5vw,22px);font-weight:750;color:#50594f}
.forbidden{background:#ffffff12;border:1px solid #ffffff25}
.forbidden h2{display:flex;align-items:center;justify-content:space-between;gap:10px;color:#ff8d80;font-size:clamp(15px,1.45vw,23px);letter-spacing:.13em;margin:0 0 9px}
.forbiddenCount{padding:5px 9px;border-radius:999px;background:rgba(255,141,128,.13);font-size:clamp(9px,.75vw,12px);letter-spacing:.09em;white-space:nowrap}
.forbiddenHint{margin:0 0 clamp(12px,2vh,22px);color:#fff4d8a8;font-size:clamp(11px,1vw,15px);line-height:1.35}
.words{display:grid;gap:.5em}
.word{font-size:clamp(22px,3.2vw,48px);font-weight:850;line-height:1.08;overflow-wrap:anywhere}
.foot{display:flex;justify-content:space-between;align-items:center;font-size:clamp(14px,1.4vw,22px);font-weight:800;color:#fff8e9b8}
.points{color:#ffd65b}
.appInvite{display:flex;align-items:center;gap:12px;color:#ffd65b;font-size:clamp(12px,1.1vw,18px);font-weight:900;letter-spacing:.08em}
.appInvite img{width:clamp(90px,13vh,128px);height:clamp(90px,13vh,128px);padding:5px;background:#fff8e9;border-radius:8px}
.joinInvite{justify-content:center;margin:4px auto}
.joinInvite img{width:clamp(160px,18vw,240px);height:clamp(160px,18vw,240px)}
.message{position:relative;inset:auto;z-index:1;min-height:100svh;display:grid;place-items:center;padding:clamp(22px,5vw,76px);background:transparent;text-align:left;font-size:inherit;font-weight:inherit;overflow:hidden}
.join{position:relative;width:min(100%,1360px);display:grid;grid-template-columns:minmax(0,1.25fr) minmax(300px,.75fr);gap:clamp(18px,3vw,42px);align-items:stretch}
.joinCopy,.joinInviteCard{border:1px solid rgba(255,177,0,.28);border-radius:30px;box-shadow:0 28px 90px #0006}
.joinCopy{position:relative;overflow:hidden;padding:clamp(28px,5vw,74px);background:linear-gradient(145deg,rgba(67,18,123,.36),rgba(16,14,19,.96) 48%);display:flex;flex-direction:column;justify-content:center;min-height:620px}
.joinCopy:after{content:"";position:absolute;width:300px;height:300px;right:-170px;bottom:-180px;border:1px solid rgba(255,177,0,.2);border-radius:50%;box-shadow:0 0 0 28px rgba(255,177,0,.025),0 0 0 58px rgba(24,166,64,.04)}
.joinBrand{display:flex;align-items:center;gap:14px;margin-bottom:clamp(40px,6vh,78px)}
.joinBrandMark{width:50px;height:50px;display:grid;place-items:center;border-radius:15px;background:var(--purple);border:3px solid var(--green);color:var(--paper);font:700 36px/1 Georgia,serif;transform:rotate(-4deg)}
.joinBrandName{font-size:13px;font-weight:950;line-height:1.15;letter-spacing:.16em}
.eyebrow{margin:0 0 15px;color:var(--gold);font-size:12px;font-weight:950;letter-spacing:.19em}
.join h1{max-width:690px;margin:0;color:var(--paper);font:700 clamp(46px,6.2vw,88px)/.97 Georgia,serif;letter-spacing:-.045em}
.joinLead{max-width:600px;margin:24px 0 34px;color:#d1cbd2;font-size:clamp(16px,1.35vw,20px);line-height:1.65}
.codeLabel{display:grid;gap:12px;max-width:570px;color:#f4e9d6;font-size:14px;font-weight:850;letter-spacing:.04em}
.join button{width:max-content;min-width:210px;min-height:58px;margin-top:18px;border:0;border-radius:12px;background:linear-gradient(110deg,#ffb100,#ffd05b);color:#090909;padding:14px 28px;font-size:16px;font-weight:950;letter-spacing:.025em;cursor:pointer;box-shadow:0 10px 28px rgba(255,177,0,.18);transition:transform .18s ease,box-shadow .18s ease}
.join button:hover{transform:translateY(-2px);box-shadow:0 14px 34px rgba(255,177,0,.28)} .pairCodePanel{max-width:620px;margin-top:26px;padding:clamp(18px,3vw,30px);border:1px solid rgba(255,177,0,.5);border-radius:22px;background:rgba(8,7,9,.68);text-align:center}.pairCodeLabel{margin:0;color:#ffd65b;font-size:clamp(11px,1vw,15px);font-weight:950;letter-spacing:.17em}.pairCode{display:block;width:100%;margin:12px 0 0;color:var(--paper);font:950 clamp(58px,6.4vw,96px)/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.16em;white-space:nowrap;word-break:keep-all;overflow:hidden;text-align:center;text-shadow:0 8px 36px rgba(255,177,0,.2)}.pairCode.isError{color:#ff8d80}.pairCodePanel button{margin-top:10px}.pairCodePanel .joinHint{margin-top:10px}.join.isConnected .pairCodePanel button{display:none}
.joinHint{min-height:22px;margin:20px 0 0;color:#bcb6bd;font-size:14px;line-height:1.5}
.joinConnection{margin:8px 0 0;padding:13px 16px;border:1px solid rgba(24,166,64,.52);border-radius:14px;background:rgba(24,166,64,.12);color:#bdf6c8;font-size:13px;font-weight:900;letter-spacing:.04em}
.joinConnection:before{content:"●";margin-right:9px;color:#18a640}
.joinInviteCard{padding:clamp(24px,3vw,42px);background:var(--paper);color:var(--ink);display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}
.inviteKicker{margin:0 0 8px;color:#236d45;font-size:12px;font-weight:950;letter-spacing:.15em}
.joinInviteCard h2{max-width:340px;margin:0 0 15px;font:700 clamp(28px,3.2vw,42px)/1 Georgia,serif;letter-spacing:-.035em}
.joinInviteCard>p:not(.inviteKicker){max-width:350px;margin:0 0 22px;color:#42433e;font-size:15px;line-height:1.55}
.qrFrame{width:min(100%,280px);aspect-ratio:1;padding:12px;border:2px solid rgba(8,7,9,.12);border-radius:20px;background:#fff;box-shadow:0 14px 30px rgba(8,7,9,.12)}
.qrFrame img{display:block;width:100%;height:100%;object-fit:contain}
.qrCaption{margin:16px 0 0;color:#236d45;font-size:12px;font-weight:950;letter-spacing:.16em}
.join .hint{font-size:14px;font-weight:500;opacity:.8}
.screenBack{min-height:40px;padding:8px 14px;border:1px solid rgba(255,244,216,.24);border-radius:999px;background:rgba(255,244,216,.08);color:#fff4d8;font:850 clamp(11px,.95vw,14px) system-ui,sans-serif;white-space:nowrap;cursor:pointer}.screenBack:hover,.screenBack:focus-visible{border-color:#ffd65b;background:rgba(255,214,91,.13);outline:2px solid rgba(255,214,91,.55);outline-offset:2px}.join.isConnected>#changeWaitingCode{display:inline-flex;align-self:flex-start;margin-top:12px}.leaveConfirm{position:fixed;inset:0;z-index:30;display:grid;place-items:center;padding:24px;background:rgba(0,0,0,.74);backdrop-filter:blur(8px)}.leaveConfirm.hidden{display:none}.leaveCard{width:min(100%,520px);padding:clamp(24px,4vw,40px);border:2px solid rgba(255,177,0,.7);border-radius:24px;background:#101a15;color:#fff4d8;box-shadow:0 24px 80px #0009}.leaveCard h2{margin:0 0 12px;font:700 clamp(26px,3vw,38px)/1.08 Georgia,serif}.leaveCard p{margin:0;color:#ded7ca;font-size:16px;line-height:1.55}.leaveActions{display:flex;justify-content:flex-end;gap:10px;margin-top:24px;flex-wrap:wrap}.leaveActions button{min-height:48px;padding:10px 18px;border:1px solid rgba(255,244,216,.22);border-radius:12px;background:rgba(255,244,216,.08);color:#fff4d8;font:850 14px system-ui,sans-serif;cursor:pointer}.leaveActions button:last-child{border-color:#ffb100;background:#ffb100;color:#101a15}.leaveActions button:focus-visible{outline:3px solid #ffd65b;outline-offset:3px}.hidden{display:none!important}
@media(min-width:821px) and (min-aspect-ratio:1/1){.message{height:100svh;min-height:0;padding:4vh 5vw;overflow:hidden}.join{width:min(100%,1440px);height:min(84svh,900px);grid-template-columns:minmax(0,1.2fr) minmax(320px,.8fr);gap:clamp(20px,3vw,44px)}.joinCopy{min-height:0;padding:clamp(28px,4vh,48px) clamp(30px,4vw,60px)}.joinBrand{margin-bottom:clamp(18px,3vh,34px)}.join h1{font-size:clamp(44px,5vw,72px)}.joinLead{margin:16px 0 22px;font-size:clamp(15px,1.2vw,18px);line-height:1.5}.pairCodePanel{margin-top:16px;padding:clamp(16px,2vw,24px)}.pairCode{font-size:clamp(58px,6vw,88px);letter-spacing:.15em}.joinInviteCard{min-height:0;padding:clamp(22px,3vw,38px)}.qrFrame{width:min(100%,250px)}.joinInviteCard h2{font-size:clamp(28px,2.8vw,40px)}}
@media(max-width:820px){.message{padding:22px}.join{grid-template-columns:1fr;max-width:620px;gap:16px}.joinCopy{min-height:0;padding:30px}.joinBrand{margin-bottom:36px}.join h1{font-size:clamp(46px,11vw,72px)}.joinLead{margin:17px 0 25px}.joinInviteCard{padding:28px}.qrFrame{width:min(56vw,230px)}.joinInviteCard h2{font-size:32px}}
@media(max-width:460px){.message{padding:13px}.joinCopy,.joinInviteCard{border-radius:22px}.joinCopy{padding:24px 20px}.joinBrand{margin-bottom:30px}.joinBrandMark{width:42px;height:42px;font-size:30px}.join h1{font-size:44px}.join button{width:100%}.pairCode{font-size:clamp(48px,14vw,68px);letter-spacing:.12em}.joinInviteCard{padding:22px}.qrFrame{width:min(68vw,215px)}.joinInviteCard h2{font-size:29px}}
@media(max-height:980px) and (min-width:821px){.message{padding:24px 4vw}.joinCopy{min-height:0;padding:32px 48px}.joinBrand{margin-bottom:24px}.join h1{font-size:clamp(46px,5.2vw,72px)}.joinLead{margin:14px 0 20px}.qrFrame{width:min(100%,205px)}.joinInviteCard{padding:24px}}
@media(max-aspect-ratio:1/1){.resultsCard{padding:22px 18px}.resultsTitle{font-size:clamp(36px,10vw,64px)}.finalScores{gap:10px}.finalScore{min-width:min(180px,40vw);padding:14px}.resultsNote{margin-top:12px}body{height:auto;min-height:100svh;overflow:auto}.shell{height:auto;min-height:100svh;padding:14px 3vw;gap:10px;overflow:visible}.top{gap:8px}.liveStatus{font-size:9px;padding:6px 8px}.team{font-size:clamp(17px,5vw,28px)}.timer{font-size:clamp(26px,7vw,40px)}.grid{flex:none;grid-template-columns:1fr;grid-template-rows:minmax(230px,1fr) auto;gap:10px}.card,.forbidden{padding:20px;border-radius:20px}.answer{font-size:clamp(42px,12vw,96px)}.words{grid-template-columns:repeat(3,1fr)}.word{font-size:clamp(18px,5vw,34px)}.foot{gap:8px;font-size:11px}.appInvite{gap:6px;font-size:9px}.appInvite img{width:76px;height:76px}}
</style></head><body>
<div id="join" class="message"><div class="join"><section class="joinCopy"><div class="joinBrand"><span class="joinBrandMark">?</span><span class="joinBrandName">WETIN<br>BE DIS</span></div><p class="eyebrow">PROJECT TO BIG SCREEN</p><h1>Bring the gist to the big screen.</h1><p class="joinLead">Open Wetin Be Dis on your phone, tap the big-screen button, and enter this code. Your cards will appear here.</p><div class="pairCodePanel"><p class="pairCodeLabel">ENTER THIS CODE ON YOUR PHONE</p><div id="pairingCode" class="pairCode">····</div><div id="joinHint" class="joinHint" aria-live="polite">Getting your code ready…</div><div id="joinConnection" class="joinConnection hidden" aria-live="polite"></div><button id="refreshCode" type="button">Get a new code <span aria-hidden="true">↻</span></button></div></section><aside class="joinInviteCard"><p class="inviteKicker">READY TO PLAY?</p><h2>Your phone is the remote.</h2><p>Choose your category and set the rules on your phone. The game will show here when you start.</p><div class="qrFrame"><img src="/app-join-qr.png" alt="QR code to open or download Wetin Be Dis"></div><p class="qrCaption">SCAN TO GET THE APP</p></aside></div></div><div id="leaveConfirm" class="leaveConfirm hidden" role="dialog" aria-modal="true" aria-labelledby="leaveTitle" aria-describedby="leaveCopy"><section class="leaveCard"><h2 id="leaveTitle">Get a new big-screen code?</h2><p id="leaveCopy">Your current phone connection will stop showing on this screen.</p><div class="leaveActions"><button id="keepScreen" type="button">Stay connected</button><button id="confirmChangeCode" type="button">Get a new code</button></div></section></div>
<main id="screen" class="shell hidden"><header class="top"><div class="brand">WETIN BE DIS</div><div class="liveStatus"><span class="liveDot"></span><span>PHONE CONNECTED</span></div><button id="backToCode" class="screenBack hidden" type="button">Change code</button><div id="team" class="team"></div><div id="timer" class="timer">0</div></header><div class="round" id="round"></div><div class="track"><div id="fill" class="fill"></div></div><section id="pregame" class="pregame hidden" aria-live="polite"><div class="pregameContent"><p id="pregameKicker" class="pregameKicker">GET READY</p><h1 id="pregameTitle" class="pregameTitle">Phone on forehead</h1><p id="pregameCopy" class="pregameCopy">Turn the phone sideways, place it on your forehead, and face the screen toward your people.</p><div id="pregameCount" class="pregameCount hidden">3</div></div></section><section class="grid" id="gameGrid"><article class="card"><div id="cardState" class="cardState">ROUND CARD</div><div id="category" class="category"></div><div id="answer" class="answer"></div><div id="difficulty" class="difficulty"></div></article><aside class="forbidden"><h2><span>DON’T SAY</span><span class="forbiddenCount">3 CLUES</span></h2><p class="forbiddenHint">Clue giver: skip these words. Describe the card without using them.</p><div id="words" class="words"></div></aside></section><section id="results" class="results hidden"><div class="resultsCard"><p class="resultsKicker">FINAL WHISTLE</p><h1 id="winnerHeading" class="resultsTitle">GAME COMPLETE</h1><div id="finalScores" class="finalScores"></div><section class="resultsReview" aria-labelledby="reviewTitle"><div class="reviewHeading"><h2 id="reviewTitle">Cards from the game</h2><p id="reviewSummary">Review every team’s clues</p></div><div id="reviewTabs" class="reviewTabs" role="tablist" aria-label="Choose a team’s cards"></div><div id="reviewCards" class="reviewCards" role="tabpanel" aria-live="polite"></div></section><p class="resultsNote">Big screen score recap · powered by Wetin Be Dis</p></div></section><footer class="foot"><span>ACT IT · SING IT · GIST IT</span><span class="appInvite"><img src="/app-join-qr.png" alt="Scan to open Wetin Be Dis or download it"><span>SCAN TO PLAY<br>OR DOWNLOAD</span></span><span id="points" class="points"></span></footer></main>
<script>
(()=>{
  const join=document.getElementById('join');
  const screen=document.getElementById('screen');
  const gameGrid=document.getElementById('gameGrid');
  const pregame=document.getElementById('pregame');
  const pregameCount=document.getElementById('pregameCount');
  const results=document.getElementById('results');
  const backToCode=document.getElementById('backToCode');
  const leaveConfirm=document.getElementById('leaveConfirm');
  const keepScreen=document.getElementById('keepScreen');
  const confirmChangeCode=document.getElementById('confirmChangeCode');
  let code='', duration=60, seconds=0, lastAt=Date.now(), dead=false;
  let lastResultsKey='', selectedReviewTeam='', currentPhase='waiting', connectionGeneration=0, pollTimeout=0;
  const set=(id,value)=>document.getElementById(id).textContent=value??'';
  const schedulePoll=()=>{clearTimeout(pollTimeout);pollTimeout=setTimeout(poll,700);};
  const createCode=async()=>{
    clearTimeout(pollTimeout);connectionGeneration+=1;dead=true;code='';currentPhase='waiting';
    history.replaceState(null,'',location.pathname);
    join.classList.remove('hidden');screen.classList.add('hidden');
    document.getElementById('pairingCode').textContent='····';
    document.getElementById('pairingCode').classList.remove('isError');
    document.getElementById('joinConnection').classList.add('hidden');
    set('joinHint','Getting your code ready…');
    try{
      const response=await fetch('/api/v1/tv-displays/display',{method:'POST',headers:{'content-type':'application/json'},body:'{}',cache:'no-store'});
      if(!response.ok)throw new Error('unavailable');
      const data=await response.json();
      if(!/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/.test(data.pairing_code||''))throw new Error('invalid');
      code=data.pairing_code;dead=false;connectionGeneration+=1;
      document.getElementById('pairingCode').textContent=code.split('').join(' ');
      set('joinHint','On your phone, open Project to Big Screen and enter this code.');
      poll();
    }catch{
      document.getElementById('pairingCode').textContent='— — — —';
      document.getElementById('pairingCode').classList.add('isError');
      set('joinHint','Could not get a code. Check the connection and try again.');
    }
  };
  document.getElementById('refreshCode').addEventListener('click',()=>createCode());
  backToCode.addEventListener('click',()=>{leaveConfirm.classList.remove('hidden');keepScreen.focus();});
  keepScreen.addEventListener('click',()=>leaveConfirm.classList.add('hidden'));
  confirmChangeCode.addEventListener('click',()=>{leaveConfirm.classList.add('hidden');createCode();});
  leaveConfirm.addEventListener('click',event=>{if(event.target===leaveConfirm)leaveConfirm.classList.add('hidden');});
  window.addEventListener('keydown',event=>{if(event.key==='Escape')leaveConfirm.classList.add('hidden');});
  const poll=async()=>{
    if(dead)return;
    const pollGeneration=connectionGeneration;
    try{
      const response=await fetch('/api/v1/tv-displays/'+encodeURIComponent(code),{cache:'no-store'});
      if(pollGeneration!==connectionGeneration)return;
      if(response.status===429){
        dead=true;set('joinHint','Too many connection attempts. Wait a minute, then refresh for another code.');return;
      }
      if(response.status===410){
        dead=true;set('joinHint','This code expired. Refreshing a new one…');createCode();return;
      }
      if(!response.ok)throw new Error('unavailable');
      const data=await response.json();
      if(pollGeneration!==connectionGeneration)return;
      const state=data.state;
      currentPhase=state.phase;
      if(!data.phone_connected){
        screen.classList.add('hidden');join.classList.remove('hidden');
        set('joinHint','On your phone, open Project to Big Screen and enter this code.');
        document.getElementById('joinConnection').classList.add('hidden');
        schedulePoll();return;
      }
      if(state.phase==='waiting'){
        join.classList.add('hidden');screen.classList.remove('hidden');
        backToCode.classList.remove('hidden');
        pregame.classList.remove('hidden');gameGrid.classList.add('hidden');results.classList.add('hidden');
        set('pregameKicker','PHONE CONNECTED');set('pregameTitle','Choose your gist');
        set('pregameCopy','Pick a category and set the rules on your phone. The game will start here.');
        pregameCount.classList.add('hidden');schedulePoll();return;
      }

      join.classList.add('hidden');
      screen.classList.remove('hidden');
      backToCode.classList.remove('hidden');
      document.getElementById('joinConnection').classList.add('hidden');
      const preparing=state.phase==='placement'||state.phase==='countdown';
      const gameOver=state.phase==='game_over';
      pregame.classList.toggle('hidden',!preparing);
      gameGrid.classList.toggle('hidden',preparing||gameOver);
      results.classList.toggle('hidden',!gameOver);
      set('team',state.team);
      set('round',gameOver?'GAME OVER':('ROUND '+state.round));

      if(preparing){
        set('timer',state.phase==='countdown'?'READY':'');
        seconds=0;lastAt=Date.now();
        document.getElementById('fill').style.width='0%';
        if(state.phase==='countdown'){
          set('pregameKicker','GET READY');
          set('pregameTitle','Hold still');
          set('pregameCopy','Keep the screen facing your people. The round starts when the countdown ends.');
          set('pregameCount',String(state.countdownRemaining||3));
          pregameCount.classList.remove('hidden');
        }else{
          set('pregameKicker','PHONE AND BIG SCREEN CONNECTED');
          set('pregameTitle','Phone on forehead');
          set('pregameCopy','Turn the phone sideways, place it on your forehead, and face the screen toward your people.');
          pregameCount.classList.add('hidden');
        }
        schedulePoll();return;
      }

      pregameCount.classList.add('hidden');
      if(gameOver){
        const finalTeams=(state.teams||[]).slice().sort((a,b)=>b.score-a.score);
        const topScore=finalTeams[0]?.score??-1;
        const winners=finalTeams.filter(team=>team.score===topScore);
        set('winnerHeading',finalTeams.length===0?'GAME COMPLETE':(winners.length>1?'IT’S A TIE':winners[0].name+' WINS!'));
        const history=Array.isArray(state.cardHistory)?state.cardHistory:[];
        const resultKey=JSON.stringify([finalTeams,history,Boolean(state.cardHistoryTruncated)]);
        if(resultKey!==lastResultsKey){
          lastResultsKey=resultKey;
          const list=document.getElementById('finalScores');
          list.replaceChildren(...finalTeams.map(team=>{
            const row=document.createElement('div');
            row.className='finalScore'+(team.score===topScore?' winner':'');
            const name=document.createElement('div');name.className='finalTeamName';name.textContent=team.name;
            const score=document.createElement('div');score.className='finalTeamPoints';score.textContent=team.score+' POINTS';
            row.append(name,score);return row;
          }));
          const teamNames=[...new Set([...finalTeams.map(team=>team.name),...history.map(entry=>entry.team)])];
          if(!teamNames.includes(selectedReviewTeam))selectedReviewTeam=teamNames[0]||'';
          const tabs=document.getElementById('reviewTabs');
          tabs.replaceChildren(...teamNames.map(name=>{
            const count=history.filter(entry=>entry.team===name).length;
            const tab=document.createElement('button');tab.type='button';tab.className='reviewTab';tab.dataset.teamName=name;tab.setAttribute('role','tab');tab.setAttribute('aria-selected',String(name===selectedReviewTeam));tab.textContent=name+' · '+count+' cards';
            tab.addEventListener('click',()=>{selectedReviewTeam=name;renderResultReview(state);});
            return tab;
          }));
          renderResultReview(state);
        }
      }
      set('timer',state.secondsRemaining+'s');
      set('cardState',state.phase==='playing'?'LIVE ROUND CARD':(state.phase==='round_end'?'ROUND COMPLETE':'GAME COMPLETE'));
      set('category',state.category);
      set('answer',state.answer||(state.phase==='round_end'?'ROUND COMPLETE':'GAME COMPLETE'));
      set('difficulty',state.difficulty);
      set('points',state.score+' POINTS');
      document.getElementById('words').replaceChildren(...state.forbiddenWords.map(word=>{
        const element=document.createElement('div');element.className='word';element.textContent=word;return element;
      }));
      duration=Math.max(1,state.roundDuration);seconds=state.secondsRemaining;lastAt=Date.now();
      document.getElementById('fill').style.width=(100*Math.min(1,seconds/duration))+'%';
    }catch{
      if(pollGeneration!==connectionGeneration)return;
      join.classList.remove('hidden');screen.classList.add('hidden');
      document.getElementById('joinConnection').classList.add('hidden');backToCode.classList.add('hidden');
      set('joinHint','Connection paused. Check your internet or refresh for a new code.');
    }
    schedulePoll();
  };
  setInterval(()=>{
    if(seconds>0){seconds=Math.max(0,seconds-(Date.now()-lastAt)/1000);lastAt=Date.now();set('timer',Math.ceil(seconds)+'s');document.getElementById('fill').style.width=(100*Math.min(1,seconds/duration))+'%';}
  },250);
  createCode();
})();
</script></body></html>`;

const APP_JOIN_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#080709"><meta name="description" content="Join your people for Wetin Be Dis, the Nigerian party guessing game."><link rel="icon" type="image/svg+xml" href="/favicon.svg?v=2"><title>Join the gist — Wetin Be Dis</title>
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:radial-gradient(ellipse at 80% 0%,#443071,transparent 48%),#07130e;color:#fff8e9;font-family:system-ui,-apple-system,sans-serif}.card{width:min(100%,680px);padding:clamp(28px,7vw,64px);border:1px solid #ffffff2b;border-top:4px solid #ffd65b;background:#101a15}.brand{color:#ffd65b;font-weight:900;letter-spacing:.18em;font-size:13px}.card h1{margin:20px 0 14px;font:900 clamp(42px,9vw,72px)/.95 Georgia,serif}.intro{max-width:500px;margin:0 0 30px;color:#e1dfd7;font-size:18px;line-height:1.55}.actions{display:grid;grid-template-columns:1fr 1fr;gap:12px}.button{display:flex;align-items:center;justify-content:center;min-height:56px;padding:12px 18px;border-radius:12px;background:#ffd65b;color:#101a15;font-size:14px;font-weight:900;text-align:center;text-decoration:none}.button.secondary{border:1px solid #ffffff48;background:#ffffff0d;color:#fff8e9}.beta{margin-top:28px;padding-top:22px;border-top:1px solid #ffffff24}.beta h2{margin:0 0 8px;font-size:21px}.beta p{margin:0 0 16px;color:#dedbd3;font-size:15px;line-height:1.55}.social{display:flex;gap:18px;flex-wrap:wrap}.social a{color:#ffd65b;font-weight:750}@media(max-width:520px){.actions{grid-template-columns:1fr}.card{padding:28px 22px}}
</style></head>
<body><main class="card"><div class="brand">YOUR PEOPLE ARE WAITING</div><h1>Join the gist.</h1><p class="intro">Wetin Be Dis is the Nigerian party guessing game for your crew. Get the app, then pass the phone and let the arguments begin.</p>
<div class="actions"><a class="button" href="https://apps.apple.com/us/app/wetin-be-dis/id6755572248">Get it on the App Store</a><a class="button secondary" href="mailto:support@wetinbedis.com?subject=Android%20closed%20beta&body=My%20Google%20Play%20Gmail%20is%3A%20">Request Android beta</a><a id="open-android-app" class="button secondary" href="wetinbedis://join" hidden>Already in beta? Open the app</a></div>
<section class="beta"><h2>Android beta is testing now.</h2><p>Email or DM us the Gmail address linked to your Play Store account to request an invite. We’re aiming for a public release around December 14; timing may change as testing continues.</p></section>
<div class="social" style="margin-top:22px"><a href="https://www.tiktok.com/@dayo.nyc">TikTok</a><a href="https://www.instagram.com/playwetinbedis/">Instagram</a></div></main><script>if(/Android/i.test(navigator.userAgent)){document.getElementById("open-android-app").hidden=false}</script></body></html>`;

const APP_SITE_ASSOCIATION = JSON.stringify({
  applinks: {
    apps: [],
    details: [{ appID: "Z8V7C7MX36.com.davidadekanbi.WetinBeDis", paths: ["/join*"] }],
  },
});

export function projectToTVPage(request: Request): Response {
  const url = new URL(request.url);
  if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
  if (url.pathname === "/.well-known/apple-app-site-association") {
    return new Response(APP_SITE_ASSOCIATION, {
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=300" },
    });
  }
  if (url.pathname === "/join" || url.pathname === "/join/") {
    return new Response(APP_JOIN_PAGE, {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" },
    });
  }
  if (url.pathname === "/tv" || url.pathname === "/tv/") {
    url.pathname = "/screen";
    return Response.redirect(url, 302);
  }
  if (url.pathname !== "/" && url.pathname !== "/screen" && url.pathname !== "/screen/") return new Response("Not found", { status: 404 });
  return new Response(PAGE, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    },
  });
}
