const assert=require('node:assert/strict');const fs=require('fs'),path=require('path'),vm=require('vm');
const code=fs.readFileSync(path.join(__dirname,'..','coach.js'),'utf8');
const start=code.lastIndexOf('function coachRealityCheck(');
assert.ok(start>=0,'Coach reality check exists');
const context={module:{exports:{}}};vm.runInNewContext(code.slice(start),context);
const check=context.module.exports.coachRealityCheck;
const player={type:'player'},pick={type:'pick'};
const base={analysis:{resB:{dOpt:0,dDepth:0,dPicks:0,dAge:0}},improvement:{mode:'flexible',ptsPerWeek:0},incoming:[player],outgoing:[player],drops:0};
function make(p={}){return {...base,...p,analysis:{resB:{...base.analysis.resB,...p.res}},improvement:{...base.improvement,...p.improvement}};}
const cases=[
 ['Flexible team production loss is not excused by youth',make({res:{dAge:-1,dOpt:-4},improvement:{mode:'flexible',ptsPerWeek:-4}}),false],
 ['Older player alone gives a rebuilder no future benefit',make({res:{dAge:0.5,dOpt:0},improvement:{mode:'rebuild'}}),false],
 ['Equal price without a practical benefit stays out',make(),false],
 ['Bench pile without usable depth stays out',make({incoming:[player,player,player]}),false],
 ['A real lineup improvement remains',make({res:{dOpt:3},improvement:{ptsPerWeek:3}}),true],
 ['Useful injury and bye depth remains',make({res:{dDepth:1},improvement:{ptsPerWeek:1}}),true],
 ['Rebuilder can trade production for picks',make({res:{dOpt:-5,dPicks:2000},improvement:{mode:'rebuild',ptsPerWeek:-5},incoming:[pick]}),true],
 ['Contender losing production for picks stays out',make({res:{dOpt:-5,dPicks:2000},improvement:{mode:'contend',ptsPerWeek:-5},incoming:[pick]}),false],
 ['Contender can bank picks without losing strength',make({res:{dPicks:2000},improvement:{mode:'contend'},incoming:[pick]}),true],
 ['Roster cuts require review even with a lineup gain',make({res:{dOpt:3},improvement:{ptsPerWeek:3},drops:1}),false],
 ['Unknown projections cannot manufacture a benefit',make({res:{dDepth:NaN}}),false],
 ['Negligible simulated gain is not a reason',make({res:{dOpt:0.01},improvement:{ptsPerWeek:0.01}}),false],
 ['Younger roster can fit a rebuild',make({res:{dAge:-0.7},improvement:{mode:'rebuild'}}),true],
 ['Youth alone does not excuse contender production loss',make({res:{dAge:-1,dOpt:-3},improvement:{mode:'contend',ptsPerWeek:-3}}),false],
];for(const [name,input,want]of cases){assert.equal(check(input).suggest,want,name);console.log('PASS',name);}console.log(cases.length+' behavior checks passed.');

