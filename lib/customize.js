/* Library for 'custom' HTML files that are to
be used from within BangleApps

See: README.md / `apps.json`: `custom` element
*/

/* Call with a JS object:

sendCustomizedApp({
  id : "7chname",

  storage:[
    {name:"-7chname", content:app_source_code},
    {name:"+7chname", content:JSON.stringify({
      name:"My app's name",
      icon:"*7chname",
      src:"-7chname"
    })},
    {name:"*7chname", content:'require("heatshrink").decompress(atob("mEwg...4"))', evaluate:true},
  ]
});


If you define an `onInit` function, this is called
with information about the currently connected device,
for instance:

```
onInit({
  id : "BANGLEJS",
  version : "2v10",
  appsInstalled : [
    {id: "boot", version: "0.28"},
    ...
  ]
});
```

If no device is connected, some fields may not be populated.
*/
function sendCustomizedApp(app) {
  console.log("<CUSTOM> sending app");
  window.postMessage({
    type : "app",
    data : app
  });
}

let __id = 0, __idlookup = [];
const Puck = {
  eval : function(data,callback) {
    __id++;
    __idlookup[__id] = callback;
    window.postMessage({type:"eval",data:data,id:__id});
  },write : function(data,callback) {
    __id++;
    __idlookup[__id] = callback;
    window.postMessage({type:"write",data:data,id:__id});
  }
};


window.addEventListener("message", function(event) {
  let msg = event.data;
  if (msg.type=="init") {
    console.log("<CUSTOM> init message received", msg.data);
    if ("undefined"!==typeof onInit)
      onInit(msg.data);
  } else if (msg.type=="evalrsp" || msg.type=="writersp"|| msg.type=="readstoragefilersp") {
    let cb = __idlookup[msg.id];
    delete __idlookup[msg.id];
    cb(msg.data);
  }
}, false);
