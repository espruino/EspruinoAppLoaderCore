let appJSON = []; // List of apps and info from apps.json
let appSortInfo = {}; // list of data to sort by, from appdates.csv { created, modified }
let files = []; // list of files on the Espruimo Device
const DEFAULTSETTINGS = {
  pretokenise : true,
  favourites : ["boot","launch","setting"],
  language : ""
};
var SETTINGS = JSON.parse(JSON.stringify(DEFAULTSETTINGS)); // clone

let device = {
  id : undefined,     // The Espruino device ID of this device, eg. BANGLEJS
  version : undefined,// The Espruino firmware version, eg 2v08
  info : undefined,   // An entry from DEVICEINFO with information about this device
  connected : false,   // are we connected via BLE right now?
  appsInstalled : []  // list of app {id,version} of installed apps
};
// FOR TESTING ONLY
/*let LANGUAGE = {
  "//":"German language translations",
  "GLOBAL": {
    "//":"Translations that apply for all apps",
    "Alarm" : "Wecker",
    "Hours" : "Stunden",
    "Minutes" : "Minuten",
    "Enabled" : "Aktiviert",
    "Settings" : "Einstellungen"
  },
  "alarm": {
    "//":"App-specific overrides",
    "Alarm" : "Alarm"
  }
};*/
var LANGUAGE = undefined;


httpGet(Const.APPS_JSON_FILE).then(apps=>{
  try {
    appJSON = JSON.parse(apps);
  } catch(e) {
    console.log(e);
    showToast("App List Corrupted","error");
  }
  // fix up the JSON
  if (appJSON.length && appJSON[appJSON.length-1]===null)
    appJSON.pop(); // remove trailing null added to make auto-generation of apps.json easier
  appJSON.forEach(app => {
    if (app.screenshots)
      app.screenshots.forEach(s => {
        if (s.url) s.url = "apps/"+app.id+"/"+s.url;
      });
  });
  var promise = Promise.resolve();
  if ("undefined" != typeof onAppJSONLoaded)
    promise = promise.then(onAppJSONLoaded);
  // finally update what we're showing
  promise.then(function() {
    refreshLibrary();
    refreshFilter();
  });
});

httpGet("appdates.csv").then(csv=>{
  document.querySelector(".sort-nav").classList.remove("hidden");
  csv.split("\n").forEach(line=>{
    let l = line.split(",");
    appSortInfo[l[0]] = {
      created : Date.parse(l[1]),
      modified : Date.parse(l[2])
    };
  });
}).catch(err=>{
  console.log("No recent.csv - app sort disabled");
});

// ===========================================  Top Navigation
function showChangeLog(appid, installedVersion) {
  let app = appNameToApp(appid);
  function show(contents) {
    let shouldEscapeHtml = true;
    if (contents && installedVersion) {
      let lines = contents.split("\n");
      for(let i = 0; i < lines.length; i++) {
        let line = lines[i];
        if (line.startsWith(installedVersion)) {
          line = '<a id="' + installedVersion + '"></a>' + line;
          lines[i] = line;
        }
      }
      contents = lines.join("<br>");
      shouldEscapeHtml = false;
    }
    showPrompt(app.name+" ChangeLog",contents,{ok:true}, shouldEscapeHtml).catch(()=>{});
    if (installedVersion) {
      var elem = document.getElementById(installedVersion);
      if (elem) elem.scrollIntoView();
    }
  }
  httpGet(`apps/${appid}/ChangeLog`).
    then(show).catch(()=>show("No Change Log available"));
}
function showReadme(appid) {
  let app = appNameToApp(appid);
  let appPath = `apps/${appid}/`;
  let markedOptions = { baseUrl : appPath };
  function show(contents) {
    if (!contents) return;
    showPrompt(app.name + " Documentation", marked(contents, markedOptions), {ok: true}, false).catch(() => {});
  }
  httpGet(appPath+app.readme).then(show).catch(()=>show("Failed to load README."));
}
function getAppDescription(app) {
  let appPath = `apps/${app.id}/`;
  let markedOptions = { baseUrl : appPath };
  return marked(app.description, markedOptions);
}

/** Setup IFRAME callbacks for handleCustomApp and handleInterface */
function iframeSetup(iframe, messageHandler) {
  // when iframe is loaded, call 'onInit' with info about the device
  iframe.addEventListener("load", function() {
    console.log("IFRAME loaded");
    /* if we get a message from the iframe (eg asking to send data to Puck), handle it
    otherwise pass to messageHandler because handleCustomApp may want to handle it */
    iframe.contentWindow.addEventListener("message",function(event) {
      let msg = event.data;
      if (msg.type=="eval") {
        Puck.eval(msg.data, function(result) {
          iframe.contentWindow.postMessage({
            type : "evalrsp",
            data : result,
            id : msg.id
          });
        });
      } else if (msg.type=="write") {
        Puck.write(msg.data, function(result) {
          iframe.contentWindow.postMessage({
            type : "writersp",
            data : result,
            id : msg.id
          });
        });
      } else if (msg.type=="readstoragefile") {
        Comms.readStorageFile(msg.data/*filename*/).then(function(result) {
          iframe.contentWindow.postMessage({
            type : "readstoragefilersp",
            data : result,
            id : msg.id
          });
        });
      } else if (messageHandler) messageHandler(event);
    }, false);
    // send the 'init' message
    iframe.contentWindow.postMessage({
      type: "init",
      data: device
    },"*");
  }, false);  
}

/** Create window for app customiser */
function handleCustomApp(appTemplate) {
  // Pops up an IFRAME that allows an app to be customised
  if (!appTemplate.custom) throw new Error("App doesn't have custom HTML");
  // if it needs a connection, do that first
  if (appTemplate.customConnect && !device.connected)
    return getInstalledApps().then(() => handleCustomApp(appTemplate));
  // otherwise continue
  return new Promise((resolve,reject) => {
    let modal = htmlElement(`<div class="modal active">
      <a href="#close" class="modal-overlay " aria-label="Close"></a>
      <div class="modal-container" style="height:100%">
        <div class="modal-header">
          <a href="#close" class="btn btn-clear float-right" aria-label="Close"></a>
          <div class="modal-title h5">${escapeHtml(appTemplate.name)}</div>
        </div>
        <div class="modal-body" style="height:100%">
          <div class="content" style="height:100%">
            <iframe src="apps/${appTemplate.id}/${appTemplate.custom}" style="width:100%;height:100%;border:0px;">
          </div>
        </div>
      </div>
    </div>`);
    document.body.append(modal);
    htmlToArray(modal.getElementsByTagName("a")).forEach(button => {
      button.addEventListener("click",event => {
        event.preventDefault();
        modal.remove();
        reject("Window closed");
      });
    });

    let iframe = modal.getElementsByTagName("iframe")[0];
    iframeSetup(iframe, function(event) {
      let msg = event.data;
      if (msg.type=="app") {
        let appFiles = msg.data;
        let app = JSON.parse(JSON.stringify(appTemplate)); // clone template
        // copy extra keys from appFiles
        Object.keys(appFiles).forEach(k => {
          if (k!="storage") app[k] = appFiles[k]
        });
        appFiles.storage.forEach(f => {
          app.storage = app.storage.filter(s=>s.name!=f.name); // remove existing item
          app.storage.push(f); // add new
        });
        console.log("Received custom app", app);
        modal.remove();
        checkDependencies(app)
          .then(()=>Comms.uploadApp(app,{device:device, language:LANGUAGE}))
          .then((appInfo)=>{
            Progress.hide({sticky:true});
            resolve(appInfo);
          }).catch(e => {
            Progress.hide({sticky:true});
            reject(e);
          });
      }
    }, false);
  });
}

/* Create window for app interface page */
function handleAppInterface(app) {
  // IFRAME interface window that can be used to get data from the app
  if (!app.interface) throw new Error("App doesn't have interface HTML");
  return new Promise((resolve,reject) => {
    let modal = htmlElement(`<div class="modal active">
      <a href="#close" class="modal-overlay " aria-label="Close"></a>
      <div class="modal-container" style="height:100%">
        <div class="modal-header">
          <a href="#close" class="btn btn-clear float-right" aria-label="Close"></a>
          <div class="modal-title h5">${escapeHtml(app.name)}</div>
        </div>
        <div class="modal-body" style="height:100%">
          <div class="content" style="height:100%">
            <iframe style="width:100%;height:100%;border:0px;">
          </div>
        </div>
      </div>
    </div>`);
    document.body.append(modal);
    htmlToArray(modal.getElementsByTagName("a")).forEach(button => {
      button.addEventListener("click",event => {
        event.preventDefault();
        modal.remove();
        //reject("Window closed");
      });
    });
    let iframe = modal.getElementsByTagName("iframe")[0];
    iframeSetup(iframe, function(event) {
      // nothing custom needed in here
    });
    iframe.src = `apps/${app.id}/${app.interface}`;
  });
}

function changeAppFavourite(favourite, app) {
  if (favourite) {
    SETTINGS.favourites = SETTINGS.favourites.concat([app.id]);
  } else {
    if ([ "boot","setting"].includes(app.id)) {
      showToast(app.name + ' is required, can\'t remove it' , 'warning');
    }else {
      SETTINGS.favourites = SETTINGS.favourites.filter(e => e != app.id);
    }
  }
  saveSettings();
  refreshLibrary();
  refreshMyApps();
}

// ===========================================  Top Navigation
function showTab(tabname) {
  htmlToArray(document.querySelectorAll("#tab-navigate .tab-item")).forEach(tab => {
    tab.classList.remove("active");
  });
  htmlToArray(document.querySelectorAll(".apploader-tab")).forEach(tab => {
    tab.style.display = "none";
  });
  document.getElementById("tab-"+tabname).classList.add("active");
  document.getElementById(tabname).style.display = "inherit";
}

// =========================================== App Info

function getAppHTML(app, appInstalled, forInterface) {
  let version = getVersionInfo(app, appInstalled);
  let versionInfo = version.text;
  if (versionInfo) versionInfo = " <small>("+versionInfo+")</small>";
  let readme = `<a class="c-hand" onclick="showReadme('${app.id}')">Read more...</a>`;
  let favourite = SETTINGS.favourites.find(e => e == app.id);
  let githubLink = Const.APP_SOURCECODE_URL ?
    `<a href="${Const.APP_SOURCECODE_URL}/${app.id}" target="_blank" class="link-github"><img src="core/img/github-icon-sml.png" alt="See the code on GitHub"/></a>` : "";
  let appurl = window.location.origin + window.location.pathname + "#" + encodeURIComponent(app.id);

  let html = `<div class="tile column col-6 col-sm-12 col-xs-12 app-tile">
  <div class="tile-icon">
    <figure class="avatar"><img src="apps/${app.icon?`${app.id}/${app.icon}`:"unknown.png"}" alt="${escapeHtml(app.name)}"></figure><br/>
  </div>
  <div class="tile-content">
    <p class="tile-title text-bold"><a name="${appurl}"></a>${escapeHtml(app.name)} ${versionInfo}</p>
    <p class="tile-subtitle">${getAppDescription(app)}${app.readme?`<br/>${readme}`:""}</p>
    ${githubLink}
  </div>
  <div class="tile-action">`;
  if (forInterface=="library") html += `
    <button class="btn btn-link btn-action btn-lg ${!app.custom?"":"d-hide"} btn-favourite" appid="${app.id}" title="Favorite"><i class="icon icon-favourite${favourite?" icon-favourite-active":""}"></i></button>
    <button class="btn btn-link btn-action btn-lg ${(appInstalled&&app.interface)?"":"d-hide"}" appid="${app.id}" title="Download data from app"><i class="icon icon-interface"></i></button>
    <button class="btn btn-link btn-action btn-lg ${app.allow_emulator?"":"d-hide"}" appid="${app.id}" title="Try in Emulator"><i class="icon icon-emulator"></i></button>
    <button class="btn btn-link btn-action btn-lg ${version.canUpdate?"":"d-hide"}" appid="${app.id}" title="Update App"><i class="icon icon-refresh"></i></button>
    <button class="btn btn-link btn-action btn-lg ${(!appInstalled && !app.custom)?"":"d-hide"}" appid="${app.id}" title="Upload App"><i class="icon icon-upload"></i></button>
    <button class="btn btn-link btn-action btn-lg ${appInstalled?"":"d-hide"}" appid="${app.id}" title="Remove App"><i class="icon icon-delete"></i></button>
    <button class="btn btn-link btn-action btn-lg ${app.custom?"":"d-hide"}" appid="${app.id}" title="Customise and Upload App"><i class="icon icon-menu"></i></button>`;
  if (forInterface=="myapps") html += `
    <button class="btn btn-link btn-action btn-lg ${!app.custom?"":"d-hide"} btn-favourite" appid="${app.id}" title="Favorite"><i class="icon icon-favourite${favourite?" icon-favourite-active":""}"></i></button>
    <button class="btn btn-link btn-action btn-lg ${(appInstalled&&app.interface)?"":"d-hide"}" appid="${app.id}" title="Download data from app"><i class="icon icon-interface"></i></button>
    <button class="btn btn-link btn-action btn-lg ${version.canUpdate?'':'d-hide'}" appid="${app.id}" title="Update App"><i class="icon icon-refresh"></i></button>
    <button class="btn btn-link btn-action btn-lg" appid="${app.id}" title="Remove App"><i class="icon icon-delete"></i></button>`;
  html += "</div>";
  if (forInterface=="library") {
    var screenshots = (app.screenshots || []).filter(s=>s.url);
    if (screenshots.length)
      html += `<img class="tile-screenshot" appid="${app.id}" src="${screenshots[0].url}" alt="Screenshot"/>`;
  }
  return html+`</div>`;
}

// =========================================== Library

// Can't use chip.attributes.filterid.value here because Safari/Apple's WebView doesn't handle it
let chips = Array.from(document.querySelectorAll('.filter-nav .chip')).map(chip => chip.getAttribute("filterid"));

/*
 Filter types:
 .../BangleApps/#blue shows apps having "blue" in app.id or app.tag --> searchType:hash
 .../BangleApps/#bluetooth shows apps having "bluetooth" in app.id or app.tag (also selects bluetooth chip) --> searchType:chip
 .../BangleApps/id=antonclk shows app having app.id = antonclk --> searchType:id
  .../BangleApps/q=clock shows apps having "clock" in app.id or app.description --> searchType:full

  the input field does full search as well
*/

let searchType = ""; // possible values: hash, chip, full, id
let searchValue = "";
let hashValue = "";
if (window.location.hash) {
  hashValue = decodeURIComponent(window.location.hash.slice(1)).toLowerCase();
  searchType = "hash";
}
let searchParams = new URLSearchParams(window.location.search);
if (window.location.search) {
  if (searchParams.has("id")) {
    searchValue = searchParams.get("id").toLowerCase();
    searchType = "id";
  }
  if (searchParams.has("q")) {
    searchValue = searchParams.get("q").toLowerCase();
    searchType = "full";
  }
}
if (searchType === "hash" && chips.indexOf(hashValue)>=0) {
  searchType = "chip";
}

let activeSort = '';

function refreshFilter(){
  let filtersContainer = document.querySelector("#librarycontainer .filter-nav");
  filtersContainer.querySelector('.active').classList.remove('active');
  if((searchType === "tag" || searchType === "chip") && hashValue) {
    filtersContainer.querySelector('.chip[filterid="'+hashValue+'"]').classList.add('active');
  }
  else filtersContainer.querySelector('.chip[filterid]').classList.add('active');
}
function refreshSort(){
  let sortContainer = document.querySelector("#librarycontainer .sort-nav");
  sortContainer.querySelector('.active').classList.remove('active');
  if(activeSort) sortContainer.querySelector('.chip[sortid="'+activeSort+'"]').classList.add('active');
  else sortContainer.querySelector('.chip[sortid]').classList.add('active');
}
function refreshLibrary() {
  let panelbody = document.querySelector("#librarycontainer .panel-body");
  let visibleApps = appJSON.slice(); // clone so we don't mess with the original

  if ((searchType === "tag" || searchType === "chip") && hashValue) {
    if ( hashValue == "favourites" ) {
      visibleApps = visibleApps.filter(app => app.id && (SETTINGS.favourites.filter( e => e == app.id).length));
    } else {
      visibleApps = visibleApps.filter(app => app.tags && app.tags.split(',').includes(hashValue));
    }
  }

  if ((searchType === "hash" || searchType === "chip") && hashValue) {
    visibleApps = visibleApps.filter(app => app.name.toLowerCase().includes(hashValue) || (app.tags && app.tags.includes(hashValue)) || app.id.toLowerCase().includes(hashValue));
  }

  if (searchType === "id" && searchValue) {
    visibleApps = visibleApps.filter(app => app.id.toLowerCase() == searchValue);
  }
  if (searchType === "full" && searchValue) {
    visibleApps = visibleApps.filter(app => app.name.toLowerCase().includes(searchValue) || app.description.toLowerCase().includes(searchValue));
  }

  visibleApps.sort(appSorter);
  if (activeSort) {
    if (activeSort=="created" || activeSort=="modified") {
      visibleApps = visibleApps.sort((a,b) =>
         (appSortInfo[b.id]||{})[activeSort] -
         (appSortInfo[a.id]||{})[activeSort]);
    } else throw new Error("Unknown sort type "+activeSort);
  }

  panelbody.innerHTML = visibleApps.map((app,idx) => {
    let appInstalled = device.appsInstalled.find(a=>a.id==app.id);
    return getAppHTML(app, appInstalled, "library");
  }).join("");
  // set badge up top
  let tab = document.querySelector("#tab-librarycontainer a");
  tab.classList.add("badge");
  tab.setAttribute("data-badge", appJSON.length);
  htmlToArray(panelbody.getElementsByTagName("button")).forEach(button => {
    button.addEventListener("click",event => {
      let button = event.currentTarget;
      let icon = button.firstChild;
      let appid = button.getAttribute("appid");
      let app = appNameToApp(appid);
      if (!app) throw new Error("App "+appid+" not found");
      // check icon to figure out what we should do
      if (icon.classList.contains("icon-emulator")) {
        // emulator
        let file = app.storage.find(f=>f.name.endsWith('.js'));
        if (!file) {
          console.error("No entrypoint found for "+appid);
          return;
        }
        let baseurl = window.location.href;
        baseurl = baseurl.substr(0,baseurl.lastIndexOf("/"));
        let url = baseurl+"/apps/"+app.id+"/"+file.url;
        window.open(`https://espruino.com/ide/emulator.html?codeurl=${url}&upload`);
      } else if (icon.classList.contains("icon-upload")) {
        // upload
        icon.classList.remove("icon-upload");
        icon.classList.add("loading");
        uploadApp(app);
      } else if (icon.classList.contains("icon-menu")) {
        // custom HTML update
        icon.classList.remove("icon-menu");
        icon.classList.add("loading");
        customApp(app);
      } else if (icon.classList.contains("icon-delete")) {
        // Remove app
        icon.classList.remove("icon-delete");
        icon.classList.add("loading");
        removeApp(app);
      } else if (icon.classList.contains("icon-refresh")) {
        // Update app
        icon.classList.remove("icon-refresh");
        icon.classList.add("loading");
        updateApp(app);
      } else if (icon.classList.contains("icon-interface")) {
        handleAppInterface(app);
      } else if ( button.classList.contains("btn-favourite")) {
        let favourite = SETTINGS.favourites.find(e => e == app.id);
        changeAppFavourite(!favourite, app);
      } else if ( button.classList.contains("tile-screenshot")) {
        console.log("Boo")
      }
    });
  });
  htmlToArray(panelbody.getElementsByClassName("tile-screenshot")).forEach(screenshot => {
    screenshot.addEventListener("click",event => {
      let icon = event.currentTarget;
      let appid = icon.getAttribute("appid");
      showScreenshots(appid);
    });
  });
}

function showScreenshots(appId) {
  let app = appJSON.find(app=>app.id==appId);
  if (!app || !app.screenshots) return;
  var screenshots = app.screenshots.filter(s=>s.url);
  showPrompt(app.name+" Screenshots",`<div class="columns">
    ${screenshots.map(s=>`
    <div class="column col-4">
      <div class="card">
        <div class="card-image">
          <img src="${s.url}" alt="Screenshot" class="img-responsive">
        </div>
      </div>
    </div>`).join("\n")}
  </div>`,{ok:true},false);
}

refreshFilter();
refreshLibrary();
// =========================================== My Apps

function uploadApp(app) {
  return getInstalledApps().then(()=>{
    if (device.appsInstalled.some(i => i.id === app.id)) {
      return updateApp(app);
    }
    checkDependencies(app)
      .then(()=>Comms.uploadApp(app,{device:device, language:LANGUAGE}))
      .then((appJSON) => {
        Progress.hide({ sticky: true });
        if (appJSON) {
          device.appsInstalled.push(appJSON);
        }
        showToast(app.name + ' Uploaded!', 'success');
      }).catch(err => {
        Progress.hide({ sticky: true });
        showToast('Upload failed, ' + err, 'error');
      }).finally(()=>{
        refreshMyApps();
        refreshLibrary();
      });
  }).catch(err => {
    showToast("Device connection failed, "+err,"error");
    // remove loading indicator
    refreshMyApps();
    refreshLibrary();
  });
}

function removeApp(app) {
  return showPrompt("Delete","Really remove '"+app.name+"'?").then(() => {
    return getInstalledApps().then(()=>{
      // a = from appid.info, app = from apps.json
      return Comms.removeApp(device.appsInstalled.find(a => a.id === app.id));
    });
  }).then(()=>{
    device.appsInstalled = device.appsInstalled.filter(a=>a.id!=app.id);
    showToast(app.name+" removed successfully","success");
    refreshMyApps();
    refreshLibrary();
  }, err=>{
    showToast(app.name+" removal failed, "+err,"error");
  });
}

function customApp(app) {
  return handleCustomApp(app).then((appJSON) => {
    if (appJSON) device.appsInstalled.push(appJSON);
    showToast(app.name+" Uploaded!", "success");
    refreshMyApps();
    refreshLibrary();
  }).catch(err => {
    showToast("Customise failed, "+err, "error");
    refreshMyApps();
    refreshLibrary();
  });
}

/// check for dependencies the app needs and install them if required
function checkDependencies(app, uploadOptions) {
  let promise = Promise.resolve();
  if (app.dependencies) {
    Object.keys(app.dependencies).forEach(dependency=>{
      var dependencyType = app.dependencies[dependency];
      function handleDependency(dependencyChecker) {
        let found = device.appsInstalled.find(dependencyChecker);
        if (found)
          console.log(`Found dependency in installed app '${found.id}'`);
        else {
          let foundApps = appJSON.filter(dependencyChecker);
          if (!foundApps.length) throw new Error(`Dependency of '${dependency}' listed, but nothing satisfies it!`);
          console.log(`Apps ${foundApps.map(f=>`'${f.id}'`).join("/")} implements '${dependencyType}:${dependency}'`);
          found = foundApps[0]; // choose first app in list
          console.log(`Dependency not installed. Installing app id '${found.id}'`);
          promise = promise.then(()=>new Promise((resolve,reject)=>{
            console.log(`Install dependency '${dependency}':'${found.id}'`);
            return Comms.uploadApp(found,{device:device}).then(appJSON => {
              if (appJSON) device.appsInstalled.push(appJSON);
              resolve();
            });
          }));
        }
      }

      if (dependencyType=="type") {
        console.log(`Searching for dependency on app TYPE '${dependency}'`);
        handleDependency(app=>app.type==dependency);
      } else if (dependencyType=="app") {
        console.log(`Searching for dependency on app ID '${dependency}'`);
        handleDependency(app=>app.id==dependency);
      } else
        throw new Error(`Dependency type '${dependencyType}' not supported`);

    });
  }
  return promise;
}

function updateApp(app) {
  if (app.custom) return customApp(app);
  return Comms.getAppInfo(app).then(remove => {
    // remove = from appid.info, app = from apps.json
    if (remove.files===undefined) remove.files="";
    // no need to remove files which will be overwritten anyway
    remove.files = remove.files.split(',')
      .filter(f => f !== app.id + '.info')
      .filter(f => !app.storage.some(s => s.name === f))
      .join(',');
    let data = AppInfo.parseDataString(remove.data)
    if ('data' in app) {
      // only remove data files which are no longer declared in new app version
      const removeData = (f) => !app.data.some(d => (d.name || d.wildcard)===f)
      data.dataFiles = data.dataFiles.filter(removeData)
      data.storageFiles = data.storageFiles.filter(removeData)
    }
    remove.data = AppInfo.makeDataString(data)
    return Comms.removeApp(remove, true);
  }).then(()=>{
    showToast(`Updating ${app.name}...`);
    device.appsInstalled = device.appsInstalled.filter(a=>a.id!=app.id);
    return checkDependencies(app);
  }).then(()=>Comms.uploadApp(app,{device:device})
  ).then((appJSON) => {
    if (appJSON) device.appsInstalled.push(appJSON);
    showToast(app.name+" Updated!", "success");
    refreshMyApps();
    refreshLibrary();
  }, err=>{
    showToast(app.name+" update failed, "+err,"error");
    refreshMyApps();
    refreshLibrary();
  });
}



function appNameToApp(appName) {
  let app = appJSON.find(app=>app.id==appName);
  if (app) return app;
  /* If app not known, add just one file
  which is the JSON - so we'll remove it from
  the menu but may not get rid of all files. */
  return { id: appName,
    name: "Unknown app "+appName,
    icon: "../unknown.png",
    description: "Unknown app",
    storage: [ {name:appName+".info"}],
    unknown: true,
  };
}

function showLoadingIndicator(id) {
  let panelbody = document.querySelector(`#${id} .panel-body`);
  let tab = document.querySelector(`#tab-${id} a`);
  // set badge up top
  tab.classList.add("badge");
  tab.setAttribute("data-badge", "");
  // Loading indicator
  panelbody.innerHTML = '<div class="tile column col-12"><div class="tile-content" style="min-height:48px;"><div class="loading loading-lg"></div></div></div>';
}

function getAppsToUpdate(options) {
  options = options||{};  // excludeCustomApps
  let appsToUpdate = [];
  device.appsInstalled.forEach(appInstalled => {
    let app = appNameToApp(appInstalled.id);
    if (app.version &&
        app.version != appInstalled.version &&
        (!options.excludeCustomApps || app.custom===undefined))
      appsToUpdate.push(app);
  });
  return appsToUpdate;
}

function refreshMyApps() {
  let panelbody = document.querySelector("#myappscontainer .panel-body");
  panelbody.innerHTML = device.appsInstalled.map(appInstalled => {
    let app = appNameToApp(appInstalled.id);
    return getAppHTML(app, appInstalled, "myapps");
  }).join("");
  htmlToArray(panelbody.getElementsByTagName("button")).forEach(button => {
    button.addEventListener("click",event => {
      let button = event.currentTarget;
      let icon = button.firstChild;
      let appid = button.getAttribute("appid");
      let app = appNameToApp(appid);
      if (!app) throw new Error("App "+appid+" not found");
      // check icon to figure out what we should do
      if (icon.classList.contains("icon-delete")) removeApp(app);
      if (icon.classList.contains("icon-refresh")) updateApp(app);
      if (icon.classList.contains("icon-interface")) handleAppInterface(app);
      if (icon.classList.contains("icon-favourite")) {
          let favourite = SETTINGS.favourites.find(e => e == app.id);
          changeAppFavourite(!favourite, app);
      }
    });
  });
  let appsToUpdate = getAppsToUpdate();
  let tab = document.querySelector("#tab-myappscontainer a");
  let updateApps = document.querySelector("#myappscontainer .updateapps");
  if (appsToUpdate.length) {
    updateApps.innerHTML = `Update ${appsToUpdate.length} apps`;
    updateApps.classList.remove("hidden");
    tab.setAttribute("data-badge", `${device.appsInstalled.length} ⬆${appsToUpdate.length}`);
  } else {
    updateApps.classList.add("hidden");
    tab.setAttribute("data-badge", device.appsInstalled.length);
  }
}

let haveInstalledApps = false;
function getInstalledApps(refresh) {
  if (haveInstalledApps && !refresh) {
    return Promise.resolve(device.appsInstalled);
  }
  showLoadingIndicator("myappscontainer");
  // Get apps and files
  return Comms.getDeviceInfo()
    .then(info => {
      device.id = info.id;
      device.version = info.version;
      device.appsInstalled = info.apps;
      haveInstalledApps = true;
      if ("function"==typeof onFoundDeviceInfo)
        onFoundDeviceInfo(device.id, device.version);
      device.info = DEVICEINFO.find(d=>d.id==device.id);
      refreshMyApps();
      refreshLibrary();
      // if the time is obviously wrong, set it up!
      console.log("Current device time is "+new Date(info.currentTime));
      if (info.currentTime < new Date("2000").getTime()) {
        console.log("Time is not set - updating it.");
        return Comms.setTime();
      }
      if (SETTINGS["settime"] && Math.abs(Date.now()-info.currentTime)>2000) {
        console.log("SETTINGS.settime=true and >2 seconds out - updating time");
        return Comms.setTime();
      }
      // Show device info in more page:
      const deviceInfoElem = document.getElementById("more-deviceinfo");
      if (deviceInfoElem) {
        deviceInfoElem.style.display = "inherit";
        const e = `<table class="table"><tbody>
  <tr><td><b>Device Type</b></td><td>${device.id}</td></tr>
  <tr><td><b>Firmware Version</b></td><td>${device.version}</td></tr>
</tbody></table>`;
        const deviceInfoContentElem = document.getElementById("more-deviceinfo-content");
        deviceInfoContentElem.innerHTML = e;
      }
    })
    .then(() => handleConnectionChange(true))
    .then(() => device.appsInstalled);
}

/// Removes everything and install the given apps, eg: installMultipleApps(["boot","mclock"], "minimal")
function installMultipleApps(appIds, promptName) {
  let apps = appIds.map( appid => appJSON.find(app=>app.id==appid) );
  if (apps.some(x=>x===undefined))
    return Promise.reject("Not all apps found, missing "+appIds.filter(appid => appJSON.find(app=>app.id==appid)===undefined ).join(","));
  let appCount = apps.length;
  return showPrompt("Install Defaults",`Remove everything and install ${promptName} apps?`).then(() => {
    return Comms.removeAllApps();
  }).then(()=>{
    Progress.hide({sticky:true});
    device.appsInstalled = [];
    showToast(`Existing apps removed. Installing  ${appCount} apps...`);
    return new Promise((resolve,reject) => {
      function upload() {
        let app = apps.shift();
        if (app===undefined) return resolve();
        Progress.show({title:`${app.name} (${appCount-apps.length}/${appCount})`,sticky:true});
        checkDependencies(app,"skip_reset")
          .then(()=>Comms.uploadApp(app,{device:device, skipReset:true}))
          .then((appJSON) => {
            Progress.hide({sticky:true});
            if (appJSON) device.appsInstalled.push(appJSON);
            showToast(`(${appCount-apps.length}/${appCount}) ${app.name} Uploaded`);
            upload();
          }).catch(function() {
            Progress.hide({sticky:true});
            reject();
          });
      }
      upload();
    });
  }).then(()=>{
    return Comms.setTime();
  }).then(()=>{
    showToast("Apps successfully installed!","success");
    return getInstalledApps(true);
  });
}

let connectMyDeviceBtn = document.getElementById("connectmydevice");

function handleConnectionChange(connected) {
  device.connected = connected;
  connectMyDeviceBtn.textContent = connected ? 'Disconnect' : 'Connect';
  connectMyDeviceBtn.classList.toggle('is-connected', connected);
  if (!connected) {
    haveInstalledApps = false;
    device.appsInstalled = [];
    refreshMyApps();
    refreshLibrary();
  }
}

htmlToArray(document.querySelectorAll(".btn.refresh")).map(button => button.addEventListener("click", () => {
  getInstalledApps(true).catch(err => {
    showToast("Getting app list failed, "+err,"error");
  });
}));
htmlToArray(document.querySelectorAll(".btn.updateapps")).map(button => button.addEventListener("click", () => {
  let appsToUpdate = getAppsToUpdate({excludeCustomApps:true});
  // get apps - don't auto-update custom apps since they need the
  // customiser page running
  let count = appsToUpdate.length;
  if (!count) {
    showToast("Update failed, no apps can be updated","error");
    return;
  }
  function updater() {
    if (!appsToUpdate.length) return Promise.resolve("Success");
    let app = appsToUpdate.pop();
    return updateApp(app).then(function() {
      return updater();
    });
  }
  updater().then(msg => {
    showToast(`Updated ${count} apps`,"success");
  }).catch(err => {
    showToast("Update failed, "+err,"error");
  });
}));
connectMyDeviceBtn.addEventListener("click", () => {
  if (connectMyDeviceBtn.classList.contains('is-connected')) {
    Comms.disconnectDevice();
    const deviceInfoElem = document.getElementById("more-deviceinfo");
    if (deviceInfoElem) deviceInfoElem.style.display = "none";
  } else {
    getInstalledApps(true).catch(err => {
      showToast("Device connection failed, "+err,"error");
    });
  }
});
Comms.watchConnectionChange(handleConnectionChange);

let filtersContainer = document.querySelector("#librarycontainer .filter-nav");
filtersContainer.addEventListener('click', ({ target }) => {
  if (target.classList.contains('active')) return;

  hashValue = target.getAttribute('filterid') || '';
  refreshFilter();
  refreshLibrary();
  window.location.hash = hashValue;
});

let librarySearchInput = document.querySelector("#searchform input");
if (searchType === "full") librarySearchInput.value = searchValue;
const searchInputChangedDebounced = debounce(refreshLibrary, 300);
librarySearchInput.addEventListener('input', evt => {
  searchValue = evt.target.value.toLowerCase();
  searchType = "full";
  if (searchParams) {
    searchParams.set("q", searchValue);
    // Update window URL
    window.history.replaceState(null, null, "?q=" + searchValue);
  }
  searchInputChangedDebounced();
});

let sortContainer = document.querySelector("#librarycontainer .sort-nav");
sortContainer.addEventListener('click', ({ target }) => {
  if (target.classList.contains('active')) return;

  activeSort = target.getAttribute('sortid') || '';
  refreshSort();
  refreshLibrary();
  if (searchType === "hash")
    window.location.hash = hashValue;
});

// =========================================== About

// Settings
let SETTINGS_HOOKS = {}; // stuff to get called when a setting is loaded
/// Load settings and update controls
function loadSettings() {
  let j = localStorage.getItem("settings");
  if (typeof j != "string") return;
  try {
    let s = JSON.parse(j);
    Object.keys(s).forEach( k => {
      SETTINGS[k]=s[k];
      if (SETTINGS_HOOKS[k]) SETTINGS_HOOKS[k]();
    } );
  } catch (e) {
    console.error("Invalid settings");
  }
}
/// Save settings
function saveSettings() {
  localStorage.setItem("settings", JSON.stringify(SETTINGS));
  console.log("Changed settings", SETTINGS);
}
// Link in settings DOM elements
function settingsCheckbox(id, name) {
  let setting = document.getElementById(id);
  function update() {
    setting.checked = SETTINGS[name];
  }
  SETTINGS_HOOKS[name] = update;
  setting.addEventListener('click', function() {
    SETTINGS[name] = setting.checked;
    saveSettings();
  });
}
settingsCheckbox("settings-pretokenise", "pretokenise");
settingsCheckbox("settings-settime", "settime");
loadSettings();

let btn;

btn = document.getElementById("defaultsettings");
if (btn) btn.addEventListener("click",event=>{
  SETTINGS = JSON.parse(JSON.stringify(DEFAULTSETTINGS)); // clone
  saveSettings();
  loadSettings(); // update all settings
  refreshLibrary(); // favourites were in settings
});

btn = document.getElementById("resetwatch");
if (btn) btn.addEventListener("click",event=>{
  Comms.resetDevice().then(()=>{
    showToast("Reset watch successfully","success");
  }, err=>{
    showToast("Error resetting watch: "+err,"error");
  });
});
btn = document.getElementById("settime");
if (btn) btn.addEventListener("click",event=>{
  Comms.setTime().then(()=>{
    showToast("Time set successfully","success");
  }, err=>{
    showToast("Error setting time, "+err,"error");
  });
});
btn = document.getElementById("removeall");
if (btn) btn.addEventListener("click",event=>{
  showPrompt("Remove All","Really remove all apps?").then(() => {
    return Comms.removeAllApps();
  }).then(()=>{
    Progress.hide({sticky:true});
    device.appsInstalled = [];
    showToast("All apps removed","success");
    return getInstalledApps(true);
  }).catch(err=>{
    Progress.hide({sticky:true});
    showToast("App removal failed, "+err,"error");
  });
});

// Install all favourite apps in one go
btn = document.getElementById("installfavourite");
if (btn) btn.addEventListener("click",event=>{
  installMultipleApps(SETTINGS.favourites, "favourite").catch(err=>{
    Progress.hide({sticky:true});
    showToast("App Install failed, "+err,"error");
  });
});
