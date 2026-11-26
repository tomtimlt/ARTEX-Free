(()=>{
"use strict";
const tasks = [
  {id:"101", name:"Opération Lagon", category_name:"Audit web", zone:"lagon", icon:0, tile:"#ddebbb", status:"running", goals_met:3, goals_total:4, goal:"Vérifier la configuration du portail public de Lagon et rattacher chaque observation à une preuve.", assets:["lagon.test","portail.lagon.test","Accueil du lagon","/meteo"], tested:4},
  {id:"102", name:"Relais Mangrove", category_name:"Revue API", zone:"mangrove", icon:5, tile:"#cce6df", status:"running", goals_met:2, goals_total:4, goal:"Documenter les services de la station Mangrove et vérifier les paramètres de son API de télémétrie.", assets:["mangrove.test","api.mangrove.test","Télémétrie Mangrove","/mesures"], tested:3},
  {id:"103", name:"Phare Azur", category_name:"Inventaire", zone:"azur", icon:6, tile:"#f9e3b2", status:"done", goals_met:5, goals_total:5, goal:"Réconcilier l’inventaire du phare avec les pages et services observés pendant la mission.", assets:["azur.test","phare.azur.test","Annuaire du phare","/balises"], tested:4},
  {id:"104", name:"Récif Saphir", category_name:"Revue réseau", zone:"saphir", icon:7, tile:"#ffddc6", status:"paused", goals_met:1, goals_total:3, goal:"Consolider les observations du récif. La reprise dépend de la validation du périmètre par l’équipe réseau.", assets:["saphir.test","sonde.saphir.test","Sondes du récif","/recifs"], tested:3},
  {id:"105", name:"Comptoir Alizé", category_name:"Audit web", zone:"alize", icon:8, tile:"#f6dec0", status:"done", goals_met:4, goals_total:4, goal:"Vérifier la configuration du catalogue de fret et documenter les écarts de configuration.", assets:["alize.test","fret.alize.test","Catalogue de fret","/manifestes"], tested:4},
  {id:"106", name:"Refuge Nacre", category_name:"Cartographie", zone:"nacre", icon:9, tile:"#dbe9c8", status:"queued", goals_met:0, goals_total:3, goal:"Préparer la cartographie du refuge à partir des quatre actifs déclarés par son équipe.", assets:["nacre.test","camp.nacre.test","Carte du refuge","/abris"], tested:0}
];
const assetTypes=["root_domain","subdomain","app","endpoint"];
const typeLabels={root_domain:"Domaine racine",subdomain:"Sous-domaine",app:"Application",endpoint:"Point d’accès"};
const assets=tasks.flatMap((t,i)=>t.assets.map((name,j)=>({id:201+i*4+j,task_ids:[Number(t.id)],name,type:assetTypes[j],tested:j<t.tested,source:j<t.tested?"Relevé de mission":"Inventaire déclaré",...((j<2)?{domain:name}:j===2?{app_name:name}:{url:"https://"+t.assets[1]+name,method:"GET"})})));
const readings=[
  [203,"high","Données de profil mises en cache","La réponse de profil autorise un cache partagé.","Cache-Control: public, max-age=900","Définir une politique de cache privée pour les pages de profil."],
  [202,"medium","Politique de contenu absente","La réponse HTML du portail ne déclare aucune politique de contenu.","Content-Type: text/html · CSP absente","Définir et valider une politique Content-Security-Policy adaptée au portail."],
  [204,"low","Bannière de version détaillée","La réponse météo publie la version complète de son serveur.","Server: CorailHTTP/2.4-demo","Réduire le niveau de détail de la bannière du serveur."],
  [207,"high","Mesures internes dans les journaux publics","Le journal de démonstration inclut des identifiants de capteurs internes.","Extrait simulé · capteur interne MG-04","Limiter la publication aux mesures prévues et revoir les droits de lecture."],
  [206,"medium","Origine de test encore autorisée","La configuration de l’API conserve une origine de préproduction.","Origine déclarée · preprod.mangrove.test","Retirer l’origine de préproduction de la configuration du service."],
  [211,"low","Contact de sécurité périmé","La fiche publique du phare référence une ancienne boîte de contact.","Fiche contact · échéance au 01/11/2026","Mettre à jour la fiche et vérifier la réception des signalements."],
  [214,"medium","Certificat proche de l’échéance","Le certificat présenté par la sonde arrive à échéance dans neuf jours.","Échéance simulée · 05/12/2026","Renouveler le certificat et contrôler la supervision de sa date d’expiration."],
  [220,"low","Politique de référent implicite","La réponse du manifeste ne fixe pas explicitement sa politique de référent.","Referrer-Policy · en-tête absent","Définir la politique de référent attendue pour le catalogue."]
];
const findings=readings.map(([asset_id,severity,title,description,evidence,recommendation],i)=>({id:301+i,asset_id,severity,title,description,evidence,recommendation,task_id:String(assets.find(a=>a.id===asset_id).task_ids[0])}));
const events=[
  ["14:32","Constat enregistré","finding",301,"!","#f7d8bd"],
  ["14:18","Actif confirmé","asset",206,"+","#d5e8ca"],
  ["13:54","Mission terminée","task",103,"✓","#cee5df"],
  ["13:21","Mission mise en pause","task",104,"Ⅱ","#f5e4ad"],
  ["12:46","Preuve ajoutée","finding",305,"+","#cde4e4"],
  ["11:30","Actif confirmé","asset",203,"+","#d5e8ca"],
  ["10:12","Mission terminée","task",105,"✓","#cee5df"],
  ["09:05","Mission en attente","task",106,"◷","#ddd8e9"]
].map(([time,title,kind,id,symbol,color])=>({time,title,kind,id:String(id),symbol,color}));

const root=document.getElementById("corail");
const screen=root.querySelector(".screen");
const nav=root.querySelector(".nav");
const pages={home:["Vue d’ensemble","▦"],tasks:["Missions","⚑"],assets:["Actifs","▤"],findings:["Constats","◇"],log:["Journal","≡"]};
const states={running:"En cours",done:"Terminée",paused:"En pause",queued:"En attente"};
const severities={high:"Élevée",medium:"Moyenne",low:"Faible"};
const findTask=id=>tasks.find(t=>t.id===String(id));
const findAsset=id=>assets.find(a=>a.id===Number(id));
const findFinding=id=>findings.find(f=>f.id===Number(id));
const pct=(n,total)=>total?Math.round(n/total*100):0;
const tested=assets.filter(a=>a.tested).length;
const pad=n=>String(n).padStart(2,"0");
const label=(kind,id)=>kind==="task"?findTask(id).name:kind==="asset"?findAsset(id).name:findFinding(id).title;
const icon=(n)=>'<i class="sprite" style="--n:'+n+'" aria-hidden="true"></i>';
const tile=t=>'<span class="tile" style="--tile:'+t.tile+'">'+icon(t.icon)+'</span>';
const chip=(v,l)=>'<span class="chip '+v+'">'+l+'</span>';
const progress=t=>{const p=pct(t.goals_met,t.goals_total);return '<span class="progresswrap" aria-label="'+p+' %"><span class="track"><i style="width:'+p+'%"></i></span><span class="pct">'+p+'%</span></span>'};
let view={page:"home",id:"",q:"",filter:"all"};
const stack=[];
const simpleNav=(p)=>Object.hasOwn(pages,p);
const group=()=>({task:"tasks",asset:"assets",finding:"findings"}[view.page]||view.page);
nav.innerHTML=Object.entries(pages).map(([k,[name,glyph]])=>'<button data-page="'+k+'"><span class="ni" aria-hidden="true">'+glyph+'</span>'+name+'</button>').join("");
const ref=(k,id)=>' data-open="'+k+'" data-id="'+id+'"';
const headline=(title,desc)=>'<section class="pageheading"><div class="kicker">Station Corail</div><h1>'+title+'</h1><p>'+desc+'</p></section>';
const back=()=>'<button class="back" data-back>‹ Retour</button>';
function navigate(page,id="",filter="all"){
  if(view.page===page && !id && filter===view.filter && !view.q)return;
  stack.push({...view});view={page,id:String(id),filter,q:""};render(true);
}
function returnView(){view=stack.pop()||{page:"home",id:"",q:"",filter:"all"};render(true)}
function missionRow(t){
 return '<button class="mrow"'+ref("task",t.id)+'><span class="identity">'+tile(t)+'<span><strong>'+t.name+'</strong><small>MS-'+t.id+' · '+t.category_name+'</small></span></span>'+chip(t.status,states[t.status])+progress(t)+'</button>';
}
const legend='<div class="legend" aria-hidden="true"><span>Mission</span><span>Statut</span><span>Objectifs</span></div>';
function eventRow(e){
 const task=e.kind==="task"?findTask(e.id):e.kind==="asset"?findTask(findAsset(e.id).task_ids[0]):findTask(findFinding(e.id).task_id);
 return '<button class="logrow"'+ref(e.kind,e.id)+' aria-label="'+e.time+' · '+e.title+' · '+label(e.kind,e.id)+'"><span class="eventicon" style="--tile:'+e.color+'" aria-hidden="true">'+e.symbol+'</span><span><strong>'+e.title+'</strong><small>'+e.time+' · '+task.name+'</small></span></button>';
}
function panelHead(n,title,side=""){return '<div class="ph"><h2>'+icon(n)+title+'</h2>'+side+'</div>'}
function home(){
 const cards=[
  ["tasks","all",tasks.length,"Missions",tasks.filter(x=>x.status==="running").length+" en cours",1,"#faeace"],
  ["assets","all",assets.length,"Actifs recensés","Sur 6 périmètres",2,"#e0edd7"],
  ["findings","all",findings.length,"Constats",findings.filter(x=>x.severity==="high").length+" de gravité élevée",3,"#f8e1cf"],
  ["assets","tested",pct(tested,assets.length)+"%","Couverture",tested+" / "+assets.length+" actifs vérifiés",4,"#dcecea"]
 ];
 return '<section class="hero"><div class="art" role="img" aria-label="Station radio et palmiers au bord d’un lagon au coucher du soleil"></div><div class="herotxt"><div class="kicker">Centre d’opérations</div><h1>STATION CORAIL</h1><p>Le poste de suivi des audits de l’archipel.</p><button class="primary" data-page="tasks"><span aria-hidden="true">⚑</span> Explorer les missions</button></div><div class="readout"><span aria-hidden="true">▥</span> SC-01 · PACIFIQUE SUD</div></section>'+
 '<div class="secthead"><h2>Vue d’ensemble</h2><span class="date">26 NOV. 2026</span></div><div class="metrics">'+cards.map(([page,f,num,name,sub,n,c])=>'<button class="metric" style="--tint:'+c+'" data-page="'+page+'" data-filter="'+f+'">'+icon(n)+'<span class="num">'+(typeof num==="number"?pad(num):num)+'</span><strong>'+name+'</strong><small>'+sub+'</small></button>').join("")+'</div>'+
 '<div class="cols"><section class="panel">'+panelHead(11,"Missions récentes",'<button class="link" data-page="tasks">Voir tout (6)</button>')+legend+tasks.slice(0,4).map(missionRow).join("")+'</section><section class="panel">'+panelHead(10,"Journal de bord",'<button class="link" data-page="log">Ouvrir</button>')+'<div class="loglist">'+events.slice(0,4).map(eventRow).join("")+'</div></section></div>';
}
const pageInfo={
 tasks:["MISSIONS","Suivi des objectifs et du périmètre de chaque mission.",1,"Missions",states,"Tous les statuts"],
 assets:["ACTIFS","Inventaire des domaines, applications et points d’accès de la station.",2,"Inventaire",{tested:"Vérifiés",pending:"À vérifier",...typeLabels},"Tous les actifs"],
 findings:["CONSTATS","Observations documentées, preuves et recommandations associées.",3,"Registre des constats",severities,"Toutes les gravités"],
 log:["JOURNAL","Événements de la station, du plus récent au plus ancien.",10,"Journal du 26 novembre",{task:"Missions",asset:"Actifs",finding:"Constats"},"Tous les événements"]
};
const norm=s=>String(s).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
const match=s=>norm(s).includes(norm(view.q.trim()));
const selected=value=>view.filter==="all"||view.filter===value;
function assetRow(a){
 const t=findTask(a.task_ids[0]);return '<button class="record"'+ref("asset",a.id)+'><span class="identity">'+tile(t)+'<span><strong>'+a.name+'</strong><small>'+typeLabels[a.type]+' · '+t.name+'</small></span></span>'+chip(a.tested?"running":"queued",a.tested?"Vérifié":"À vérifier")+'</button>';
}
function findingRow(f){
 const t=findTask(f.task_id);return '<button class="record"'+ref("finding",f.id)+'><span class="identity">'+tile(t)+'<span><strong>'+f.title+'</strong><small>CT-'+f.id+' · '+findAsset(f.asset_id).name+'</small></span></span>'+chip(f.severity,severities[f.severity])+'</button>';
}
function filtered(){
 const p=view.page;
 if(p==="tasks")return tasks.filter(t=>selected(t.status)&&match([t.name,t.category_name,"MS-"+t.id].join(" "))).map(missionRow);
 if(p==="assets")return assets.filter(a=>(selected(a.type)||selected(a.tested?"tested":"pending"))&&match([a.name,a.url||"",typeLabels[a.type],findTask(a.task_ids[0]).name].join(" "))).map(assetRow);
 if(p==="findings")return findings.filter(f=>selected(f.severity)&&match([f.title,"CT-"+f.id,findAsset(f.asset_id).name,findTask(f.task_id).name].join(" "))).map(findingRow);
 return events.filter(e=>selected(e.kind)&&match([e.title,e.time,label(e.kind,e.id),e.kind==="asset"?findTask(findAsset(e.id).task_ids[0]).name:e.kind==="finding"?findTask(findFinding(e.id).task_id).name:""].join(" "))).map(eventRow);
}
function drawResults(){
 const rows=filtered();screen.querySelector(".results").innerHTML=rows.length?rows.join(""):'<p class="empty">Aucun résultat pour cette recherche.</p>';
 screen.querySelector(".listfooter").textContent=rows.length+" résultat"+(rows.length>1?"s":"");
}
function list(){
 const [title,desc,n,panel,opts,all]=pageInfo[view.page];
 return headline(title,desc)+'<section class="panel">'+panelHead(n,panel)+'<div class="tools"><label class="searchbox"><span aria-hidden="true">⌕</span><span class="sr">Rechercher dans la liste</span><input type="search" placeholder="Rechercher…" autocomplete="off"></label><label><span class="sr">Filtrer les résultats</span><select><option value="all">'+all+'</option>'+Object.entries(opts).map(([value,name])=>'<option value="'+value+'">'+name+'</option>').join("")+'</select></label></div>'+(view.page==="tasks"?legend:"")+'<div class="results '+(view.page==="log"?"loglist":"")+'"></div><div class="listfooter" aria-live="polite"></div></section>';
}
const miniPanel=(n,title,html)=>'<section class="panel">'+panelHead(n,title)+html+'</section>';
const related=(kind,id,title,sub)=>'<button class="related"'+ref(kind,id)+'><span><strong>'+title+'</strong><small>'+sub+'</small></span><span aria-hidden="true">›</span></button>';
const textBox=(title,html)=>'<div class="detail"><h2>'+title+'</h2><p>'+html+'</p></div>';
const detailTitle=(title,id,sub)=>'<div class="pageheading"><div class="kicker">'+id+'</div><h1 style="font:700 clamp(25px,3.8vw,42px)/1.2 var(--mono);letter-spacing:-.06em">'+title+'</h1><p>'+sub+'</p></div>';
function details(){
 if(view.page==="task"){
  const t=findTask(view.id), items=assets.filter(a=>a.task_ids.includes(+t.id)), obs=findings.filter(f=>f.task_id===t.id);
  return back()+detailTitle(t.name,"Mission / MS-"+t.id,t.category_name+" · "+t.assets[0])+'<section class="panel"><div class="detail">'+chip(t.status,states[t.status])+'<h2>Objectif de mission</h2><p>'+t.goal+'</p><p style="margin-top:12px"><strong>'+t.goals_met+' / '+t.goals_total+' objectifs atteints</strong></p></div></section><div class="detailgrid">'+miniPanel(2,"Actifs liés ("+items.length+")",items.map(assetRow).join(""))+miniPanel(3,"Constats ("+obs.length+")",obs.length?obs.map(findingRow).join(""):'<p class="empty">Aucun constat enregistré.</p>')+'</div>';
 }
 if(view.page==="asset"){
  const a=findAsset(view.id),t=findTask(a.task_ids[0]),obs=findings.filter(f=>f.asset_id===a.id);
  return back()+detailTitle(a.name,"Actif / AC-"+a.id,typeLabels[a.type])+'<section class="panel"><div class="detail">'+chip(a.tested?"running":"queued",a.tested?"Vérifié":"À vérifier")+'<h2>Fiche de l’actif</h2><p>'+[a.source,a.url||a.app_name||a.domain].join(" · ")+'</p></div></section><div class="detailgrid">'+miniPanel(1,"Mission liée",related("task",t.id,t.name,t.category_name))+miniPanel(3,"Constats liés ("+obs.length+")",obs.length?obs.map(findingRow).join(""):'<p class="empty">Aucun constat lié à cet actif.</p>')+'</div>';
 }
 const f=findFinding(view.id),a=findAsset(f.asset_id),t=findTask(f.task_id);
 return back()+detailTitle(f.title,"Constat / CT-"+f.id,t.name)+'<section class="panel"><div class="detail">'+chip(f.severity,"Gravité "+severities[f.severity].toLowerCase())+'<h2>Observation</h2><p>'+f.description+'</p></div></section><div class="detailgrid"><section class="panel">'+textBox("Preuve simulée",f.evidence)+'</section><section class="panel">'+textBox("Recommandation",f.recommendation)+'</section></div><div class="detailgrid">'+miniPanel(2,"Actif concerné",related("asset",a.id,a.name,typeLabels[a.type]))+miniPanel(1,"Mission liée",related("task",t.id,t.name,t.category_name))+'</div>';
}
function render(moveFocus=false){
 for(const b of nav.querySelectorAll("button")){if(b.dataset.page===group())b.setAttribute("aria-current","page");else b.removeAttribute("aria-current")}
 screen.innerHTML=view.page==="home"?home():simpleNav(view.page)?list():details();
 if(pageInfo[view.page]){
  screen.querySelector("input").value=view.q;screen.querySelector("select").value=view.filter;drawResults();
 }
 if(moveFocus){
  const h=screen.querySelector("h1");h.tabIndex=-1;h.focus({preventScroll:true});if(root.getBoundingClientRect().top<0)root.scrollIntoView({block:"start"});
 }
}
root.addEventListener("click",event=>{
 const b=event.target.closest("button");if(!b||!root.contains(b))return;
 if(b.hasAttribute("data-back"))returnView();
 else if(b.dataset.open)navigate(b.dataset.open,b.dataset.id);
 else if(b.dataset.page)navigate(b.dataset.page,"",b.dataset.filter||"all");
});
root.addEventListener("input",event=>{if(event.target.type==="search"){view.q=event.target.value;drawResults()}});
root.addEventListener("change",event=>{if(event.target.tagName==="SELECT"){view.filter=event.target.value;drawResults()}});
render();
})();
