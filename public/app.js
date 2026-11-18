const $ = id => document.getElementById(id);
let currentUser = null, currentView = "progress", orders = [], chart = null;
const viewInfo = {
  progress: ["OVERVIEW","In Progress","Orders currently being produced."],
  logistics: ["FULFILMENT","Logistics","Orders that still need to be handed over or delivered."],
  done: ["COMPLETED","Completed","Finished orders waiting to be received."],
  canceled: ["ARCHIVE","Canceled Orders","Orders canceled by an administrator."],
  analytics: ["PERFORMANCE","Staff Analytics","Compare completed and canceled work by staff member."]
};
const pretty = value => ({IN_PROGRESS:"In Progress",DONE:"Done",CANCELED:"Canceled",RECEIVED:"Received",PAID:"Paid",NOT_PAID:"Not Paid",DOWN_PAYMENT:"Down Payment",DELIVERY:"Delivery",LOCAL_DELIVERY:"Local Delivery",PICK_UP:"Pick up"}[value] || value);
const money = value => new Intl.NumberFormat(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}).format(value);
const dateText = value => new Date(value).toLocaleDateString(undefined,{year:"numeric",month:"short",day:"numeric"});
async function api(url, options={}) {
  const response = await fetch(url,{credentials:"same-origin",headers:{"Content-Type":"application/json",...(options.headers||{})},...options});
  const data = await response.json().catch(()=>({}));
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}
function showAlert(message){$("alert").textContent=message;$("alert").classList.remove("hidden");setTimeout(()=>$("alert").classList.add("hidden"),4500);}
function showApp(user){
  currentUser=user;$("loginScreen").classList.add("hidden");$("app").classList.remove("hidden");
  $("userName").textContent=user.name;$("userRole").textContent=user.role==="ADMIN"?"Administrator":"Staff member";$("userAvatar").textContent=user.name.slice(0,1).toUpperCase();
  document.querySelectorAll(".admin-only").forEach(el=>el.classList.toggle("hidden",user.role!=="ADMIN"));
  $("pageDate").textContent=new Date().toLocaleDateString(undefined,{weekday:"long",year:"numeric",month:"long",day:"numeric"});
  loadView("progress");
}
async function boot(){try{const data=await api("/api/auth/me");showApp(data.user);}catch{$("loginScreen").classList.remove("hidden");}}
$("loginForm").addEventListener("submit",async e=>{e.preventDefault();$("loginError").textContent="";try{const d=await api("/api/auth/login",{method:"POST",body:JSON.stringify({email:$("loginEmail").value,password:$("loginPassword").value})});showApp(d.user);}catch(err){$("loginError").textContent=err.message;}});
$("logoutBtn").addEventListener("click",async()=>{await api("/api/auth/logout",{method:"POST"});location.reload();});
$("navigation").addEventListener("click",e=>{const b=e.target.closest("[data-view]");if(b)loadView(b.dataset.view);});
$("newOrderBtn").addEventListener("click",()=>openOrder());
$("closeDialog").onclick=$("cancelDialog").onclick=()=> $("orderDialog").close();
$("searchInput").addEventListener("input",renderOrders);$("sortSelect").addEventListener("change",renderOrders);

async function loadView(view){
  if(view==="analytics"&&currentUser.role!=="ADMIN")return;
  currentView=view;document.querySelectorAll(".nav-link").forEach(b=>b.classList.toggle("active",b.dataset.view===view));
  const info=viewInfo[view];$("sectionEyebrow").textContent=info[0];$("pageTitle").textContent=info[1];$("pageDescription").textContent=info[2];
  $("ordersPanel").classList.toggle("hidden",view==="analytics");$("analyticsPanel").classList.toggle("hidden",view!=="analytics");
  $("orderCount").classList.toggle("hidden",view==="analytics");
  if(view==="analytics"){await loadAnalytics();return;}
  $("searchInput").value="";
  try{const data=await api(`/api/orders?view=${view}`);orders=data.orders;$("orderCount").textContent=`${orders.length} order${orders.length===1?"":"s"}`;if(view==="progress")$("progressCount").textContent=orders.length;renderOrders();}
  catch(err){showAlert(err.message);}
}
function renderOrders(){
  let list=[...orders],q=$("searchInput").value.toLowerCase();
  list=list.filter(o=>[o.customerName,o.phoneNumber,o.orderDetail,o.laborName].join(" ").toLowerCase().includes(q));
  const sort=$("sortSelect").value;
  list.sort((a,b)=>sort==="oldest"?new Date(a.orderDate)-new Date(b.orderDate):sort==="customer"?a.customerName.localeCompare(b.customerName):new Date(b.orderDate)-new Date(a.orderDate));
  const grid=$("ordersGrid");
  if(!list.length){grid.innerHTML=`<div class="empty"><div class="text-3xl mb-3">▤</div><div class="font-bold text-slate-600">Nothing here yet</div><p class="text-xs mt-1">Orders matching this view will appear here.</p></div>`;return;}
  grid.innerHTML=list.map(o=>{
    const status=o.status.toLowerCase().replace("_","-");
    let actions="";
    if(currentUser.role==="ADMIN"){
      if(currentView==="progress")actions=`<button class="action green" data-action="DONE" data-id="${o.id}">Mark as Done</button><button class="action red" data-action="CANCELED" data-id="${o.id}">Cancel</button>`;
      if(currentView==="done")actions=`<button class="action" data-action="IN_PROGRESS" data-id="${o.id}">↶ Undo</button><button class="action green" data-action="RECEIVED" data-id="${o.id}">Mark as Received</button>`;
      if(currentView==="canceled")actions=`<button class="action" data-action="IN_PROGRESS" data-id="${o.id}">↶ Undo / Return</button>`;
    }
    actions+=`<button class="action dark" data-edit="${o.id}">Edit</button>`;
    return `<article class="order-card">
      <div class="order-top"><div><div class="customer">${escapeHtml(o.customerName)}</div><div class="order-id">#${o.id.slice(0,8).toUpperCase()} · ${dateText(o.orderDate)}</div></div><span class="status ${status}">${pretty(o.status)}</span></div>
      <p class="order-detail">${escapeHtml(o.orderDetail)}</p>
      <div class="meta-grid"><div><div class="meta-label">Staff / designer</div><div class="meta-value">${escapeHtml(o.laborName)}</div></div><div><div class="meta-label">Phone</div><div class="meta-value">${escapeHtml(o.phoneNumber)}</div></div><div><div class="meta-label">Receiving</div><div class="meta-value">${pretty(o.receivingMethod)}</div></div><div><div class="meta-label">Payment</div><div class="meta-value">${pretty(o.paymentDetail)} · ${escapeHtml(o.paymentMethod)}</div></div></div>
      <div class="card-footer"><div><div class="meta-label">Order total</div><div class="price">${money(o.price)}</div></div><div class="card-actions">${actions}</div></div>
    </article>`;
  }).join("");
}
function escapeHtml(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
$("ordersGrid").addEventListener("click",async e=>{
  const edit=e.target.closest("[data-edit]");if(edit){const o=orders.find(x=>x.id===edit.dataset.edit);openOrder(o);return;}
  const action=e.target.closest("[data-action]");if(!action)return;
  const type=action.dataset.action,id=action.dataset.id;
  const prompts={DONE:"Mark this order as done?",CANCELED:"Cancel this order?",IN_PROGRESS:"Return this order to In Progress?",RECEIVED:"Mark this order as received? This also removes it from Logistics."};
  if(!confirm(prompts[type]))return;
  try{
    if(type==="RECEIVED")await api(`/api/orders/${id}/received`,{method:"PATCH",body:"{}"});
    else await api(`/api/orders/${id}/status`,{method:"PATCH",body:JSON.stringify({status:type})});
    await loadView(currentView);
  }catch(err){showAlert(err.message);}
});
function openOrder(o){
  $("orderForm").reset();$("formError").textContent="";$("orderId").value=o?.id||"";
  $("formTitle").textContent=o?"Edit order":"Create new order";
  $("orderDate").value=o?new Date(o.orderDate).toISOString().slice(0,10):new Date().toISOString().slice(0,10);
  ["laborName","customerName","phoneNumber","orderDetail","price","paymentDetail","receivingMethod","paymentMethod"].forEach(k=>$(k).value=o?o[k]:({paymentDetail:"NOT_PAID",receivingMethod:"PICK_UP",paymentMethod:"Cash"}[k]||""));
  $("orderDialog").showModal();
}
$("orderForm").addEventListener("submit",async e=>{
  e.preventDefault();$("formError").textContent="";
  const body={orderDate:$("orderDate").value,laborName:$("laborName").value,customerName:$("customerName").value,phoneNumber:$("phoneNumber").value,orderDetail:$("orderDetail").value,price:$("price").value,paymentDetail:$("paymentDetail").value,receivingMethod:$("receivingMethod").value,paymentMethod:$("paymentMethod").value};
  try{const id=$("orderId").value;await api(id?`/api/orders/${id}`:"/api/orders",{method:id?"PATCH":"POST",body:JSON.stringify(body)});$("orderDialog").close();await loadView(currentView);}catch(err){$("formError").textContent=err.message;}
});
async function loadAnalytics(){
  try{const d=await api("/api/orders/analytics/staff");if(chart)chart.destroy();
    chart=new Chart($("staffChart"),{type:"bar",data:{labels:d.labels,datasets:[{label:"Done",data:d.done,backgroundColor:"#a8e45f",borderRadius:6},{label:"Canceled",data:d.canceled,backgroundColor:"#f0a1a1",borderRadius:6}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:"bottom",labels:{usePointStyle:true,boxWidth:8,font:{family:"DM Sans"}}}},scales:{x:{grid:{display:false},ticks:{font:{family:"DM Sans"}}},y:{beginAtZero:true,ticks:{precision:0},grid:{color:"#edf0f4"}}}}});
  }catch(err){showAlert(err.message);}
}
boot();
