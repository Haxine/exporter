@import("constants.js")
@import("lib/utils.js")
@import("exporter/exporter-build-html.js")
@import("exporter/my_layer.js")
@import("exporter/my_artboard.js")
@import("exporter/my_layer_resizer.js")
@import("exporter/publisher.js") // we need it to run resize.sh script

var exporter = undefined

const replaceValidKeys = ["name","frame","x","y","width","height","childs","constrains"]
function replacer(key, value) {
  // Pass known keys and array indexes
  if (value!=undefined && (replaceValidKeys.indexOf(key)>=0 ||  !isNaN(key))) {
    //log("VALID "+key)
    return value
  }    
  //log("INVALID "+key)
  return undefined
}


class Exporter {

  constructor(selectedPath, doc, page, exportOptions,context) {       
    this.Settings = require('sketch/settings');
    this.Sketch = require('sketch/dom');
    this.Doc = this.Sketch.fromNative(doc);
    this.doc = doc;
    this.page = page;
    this.context = context;

    this.myLayers = []

    // workaround for Sketch 52
    this.docName = this._clearCloudName(this.context.document.cloudName())
    let posSketch =  this.docName.indexOf(".sketch")
    if(posSketch>0){
      this.docName = this.docName.slice(0,posSketch)
    }
    // @workaround for Sketch 52

    this.prepareOutputFolder(selectedPath);

    this._readSettings()
    this.jsStory = '';

    this.exportOptions = exportOptions

    this.pagesDict = []
    this.pageIDsDict = []

    this.errors = []

    // init global variable
    exporter = this
  }

  _readSettings() {
    this.retinaImages = this.Settings.settingForKey(SettingKeys.PLUGIN_DONT_RETINA_IMAGES)!=1
    this.enabledJSON = this.Settings.settingForKey(SettingKeys.PLUGIN_SAVE_JSON)==1
    this.disableFixedLayers = this.Settings.documentSettingForKey(this.doc,SettingKeys.DOC_DISABLE_FIXED_LAYERS)==1

    let pluginSortRule = this.Settings.settingForKey(SettingKeys.PLUGIN_SORT_RULE)
    if(undefined==pluginSortRule) pluginSortRule = Constants.SORT_RULE_X
    const docCustomSortRule = this.Settings.documentSettingForKey(this.doc,SettingKeys.DOC_CUSTOM_SORT_RULE)
    this.sortRule = undefined==docCustomSortRule || docCustomSortRule<0 ? pluginSortRule : docCustomSortRule

    let backColor = this.Settings.documentSettingForKey(this.doc,SettingKeys.DOC_BACK_COLOR)
    if(undefined==backColor) backColor = ""
    this.backColor = backColor
  }

  
  collectArtboardGroups(){
    this.myLayers = []
    this.artboardGroups.forEach(function (artboardGroup) {
      const artboard = artboardGroup[0].artboard;
      this.myLayers.push(this.getCollectLayer(artboard,undefined))
    }, this);
  }

  getCollectLayer(layer,myParent){
    const myLayer = new MyLayer(layer,myParent)    

    if(myLayer.isSymbolInstance){      
      //myLayer.childs.push( this.getCollectLayer(layer.symbolMaster(),myLayer)  )
      myLayer.childs =  this.getCollectLayerChilds(layer.symbolMaster().layers(),myLayer)
    }else if(myLayer.isGroup){
      myLayer.childs =  this.getCollectLayerChilds(layer.layers(),myLayer)
    }else{

    }
    return myLayer
  }


  getCollectLayerChilds(layers,myParent){
    const myLayers = []
   
    layers.forEach(function (childLayer) {
      myLayers.push( this.getCollectLayer(childLayer,myParent) )
    }, this);
   
    return myLayers
  }

  log(msg){
    if(!Constants.LOGGING) return
    log(msg)
  }

  logLayer(msg){
    if(!Constants.LAYER_LOGGING) return
    log(msg)
  }


  logError(error){
    log("[ ERROR ] "+error)
    this.errors.push(error)
  }

  stopWithError(error){
    const UI = require('sketch/ui')
    UI.alert('Error', error)
    exit = true
  }

  _clearCloudName(cloudName)
  {
    let name = cloudName
    let posSketch =  name.indexOf(".sketch")
    if(posSketch>0){
      name = name.slice(0,posSketch)
    }
    return name
  }


  prepareFilePath(filePath,fileName)
  {
    const fileManager = NSFileManager.defaultManager();
    const targetPath = filePath + '/'+fileName;

    let error = MOPointer.alloc().init();
    if (!fileManager.fileExistsAtPath(filePath)) {
      if (!fileManager.createDirectoryAtPath_withIntermediateDirectories_attributes_error(filePath, false, null, error)) {
        log(error.value().localizedDescription());
      }
    }

    error = MOPointer.alloc().init();
    if (fileManager.fileExistsAtPath(targetPath)) {
      if (!fileManager.removeItemAtPath_error(targetPath, error)) {
        log(error.value().localizedDescription());
      }
    }
    return targetPath;
  }


  copyStatic(resFolder) {    
    const fileManager = NSFileManager.defaultManager();
    const targetPath = this.prepareFilePath(this._outputPath,resFolder);
    
    const sourcePath = this.context.plugin.url().URLByAppendingPathComponent("Contents").URLByAppendingPathComponent("Sketch").URLByAppendingPathComponent(resFolder).path();
    let error = MOPointer.alloc().init();
    if (!fileManager.copyItemAtPath_toPath_error(sourcePath, targetPath, error)) {
      log(error.value().localizedDescription());
    }
  }

  generateJSStoryBegin(){
    const disableHotspots = this.Settings.settingForKey(SettingKeys.PLUGIN_DISABLE_HOTSPOTS)==1

    this.jsStory = 
    'var story = {\n'+
    '"docName": "'+ Utils.toFilename(this.docName)+'",\n'+
    '"docPath": "P_P_P",\n'+
    '"docVersion": "V_V_V",\n'+
    '"hasRetina": '+(this.retinaImages?'true':'false') + ',\n'+
    '"disableHotspots": '+(disableHotspots?'true':'false') + ',\n'+
    '"pages": [\n';
  }


  createJSStoryFile(){
    const fileName = 'story.js';
    return this.prepareFilePath(this._outputPath + "/" + Constants.VIEWER_DIRECTORY,fileName);
  }

  generateJSStoryEnd(){
    this.jsStory += 
     '   ]\n,'+
     '"resolutions": ['+(this.retinaImages?'2':'1')+'],\n'+
     '"title": "'+this.docName+'",\n'+
     ''+
     '"highlightLinks": false\n'+
    '}\n';

    const pathStoryJS = this.createJSStoryFile();
    Utils.writeToFile(this.jsStory, pathStoryJS);
  }

  createMainHTML(){
    const docName = this.docName

    let position = this.Settings.settingForKey(SettingKeys.PLUGIN_POSITION)
    const isPositionCenter = position === Constants.POSITION_CENTER
    
    const docHideNav = this.Settings.documentSettingForKey(this.doc,SettingKeys.DOC_CUSTOM_HIDE_NAV)
    let hideNav = docHideNav==undefined||docHideNav==0?this.Settings.settingForKey(SettingKeys.PLUGIN_HIDE_NAV)==1 : docHideNav==2

    let commentsURL = this.Settings.settingForKey(SettingKeys.PLUGIN_COMMENTS_URL)
    if(commentsURL==undefined) commentsURL = ''
    let googleCode = this.Settings.settingForKey(SettingKeys.PLUGIN_GOOGLE_CODE)
    if(googleCode==undefined) googleCode = ''
    if(""==this.backColor) this.backColor = Constants.DEF_BACK_COLOR
  
    
    const s = buildMainHTML(docName,isPositionCenter,commentsURL,hideNav,googleCode,this.backColor);

    const filePath = this.prepareFilePath(this._outputPath,'index.html');
    Utils.writeToFile(s, filePath);
  }



  getArtboardGroups(context) {

    const artboardGroups = [];

    if(this.exportOptions==null){
      this.doc.pages().forEach(function(page){
        // skip marked by '*'
        log('name='+page.name())
        if(page.name().indexOf("*")==0){
          return
        }
        let artBoards = MyArtboard.getArtboardGroupsInPage(page, context, false)
        if(!artBoards.length) return
        
        if(Constants.SORT_RULE_X == this.sortRule){
          artBoards.sort((
            function(a, b){
              return a[0].artboard.absoluteRect().x()-b[0].artboard.absoluteRect().x()
          }))
        }else  if(Constants.SORT_RULE_REVERSIVE_SKETCH == this.sortRule){
          artBoards = artBoards.reverse()
        }else{
        }

        artboardGroups.push.apply(artboardGroups,artBoards);
      },this)
    }else if (this.exportOptions.mode==Constants.EXPORT_MODE_CURRENT_PAGE){      
      artboardGroups.push.apply(artboardGroups, MyArtboard.getArtboardGroupsInPage(this.exportOptions.currentPage, context, false));
    }else if (this.exportOptions.mode==Constants.EXPORT_MODE_SELECTED_ARTBOARDS){
      const list = []
      for (var i = 0; i < this.exportOptions.selectedArtboards.length; i++) {
        list.push(this.exportOptions.selectedArtboards[i].sketchObject)        
      }
      artboardGroups.push.apply(artboardGroups,Utils.getArtboardGroups(list, context))  
    }else{
      log('ERROR: unknown export mode: '.this.exportOptions.mode)
    }

    // try to find flowStartPoint and move it on top  
    for (var i = 0; i < artboardGroups.length; i++) {
      const a = artboardGroups[i][0].artboard;
      if( a.isFlowHome() ){
         if(i!=0){              
              // move found artgroup to the top
              const item1 = artboardGroups[i];
              artboardGroups.splice(i,1);
              artboardGroups.splice(0,0,item1);
          }
          break;
      }
    }

    return artboardGroups;
  }

  buildSymbolDict() {
    var symDict = []

    for(var symbol of this.Doc.getSymbols()){
      const sid = symbol.symbolId
      const skSymbol = symbol.sketchObject      
      if( sid in symDict) continue
      symDict[ sid ] = skSymbol      
    }

    this.symDict = symDict
  }

  filterArtboards(){
    const filtered = []
    for(var artboard of this.myLayers){
      // Skip artboards with external URL enabled
      if(artboard.externalArtboardURL!=undefined) continue
      artboard.pageIndex = filtered.length
      filtered.push(artboard)      
    }
    this.myLayers = filtered
  }


  exportArtboardImagesAndDef(){
    log(" exportImages: running...")
    this.totalImages = 0

    for(var artboard of this.myLayers){
      artboard.export();    
    }
    log(" exportImages: done!")
  }

  buildPreviews(){
    log(" buildPreviews: running...")
    const pub = new Publisher(this.context,this.context.document);    
    pub.copyScript("resize.sh")
    const res = pub.runScriptWithArgs("resize.sh",[this.imagesPath])
    log(" buildPreviews: done!")
    if(!res.result) pub.showOutput(res)    
  }

  createViewerFile(fileName){
    return this.prepareFilePath(this._outputPath + "/" + Constants.VIEWER_DIRECTORY,fileName);
  }

  generateJSStoryEnd(){
    this.jsStory += 
     '   ]\n,'+
     '"resolutions": ['+(this.retinaImages?'2':'1')+'],\n'+
     '"title": "'+this.docName+'",\n'+
     '"totalImages": '+this.totalImages+',\n'+
     '"highlightLinks": false\n'+
    '}\n';

    const pathStoryJS = this.createViewerFile('story.js')
    Utils.writeToFile(this.jsStory, pathStoryJS)
  }

  saveToJSON(){
    if( !this.enabledJSON ) return true

    log(" SaveToJSON: cleanup before saving...")
    for(var l of this.myLayers) l.clearRefsBeforeJSON()

    log(" SaveToJSON: running...")
    const layersJSON = JSON.stringify(this.myLayers,replacer)
    const pathJSFile = this.createViewerFile('layers.json')
    Utils.writeToFile(layersJSON, pathJSFile)
    log(" SaveToJSON: done!")

    return true
  }

  exportArtboards() {        
    log("exportArtboards: running...")

    // Collect artboards and prepare caches
    this.artboardGroups = this.getArtboardGroups(this.context);
    
    // Collect all layers
    this.buildSymbolDict()
    {
      const layerCollector  = new MyLayerCollector()
      layerCollector.collectArtboardsLayers(" ")
    }        
    // Resize layers and build links
    {
      const layerResizer  = new MyLayerResizer()
      layerResizer.resizeLayers(" ")
    }    

    // Remove external URLs and other garbage
    this.filterArtboards()

    // Copy static files
    this.copyStatic("resources");
    this.copyStatic("viewer");

    // Build main HTML file
    this.createMainHTML();

    // Build Story.js with hotspots  
    this.generateJSStoryBegin();
    let index = 0;

    // Export every artboard into PNG image
    this.exportArtboardImagesAndDef()

    this.generateJSStoryEnd();

    // Build image small previews for Gallery
    this.buildPreviews()

    // Dump document layers to JSON file
    this.saveToJSON()

    log("exportArtboards: done!")

  }  

  prepareOutputFolder(selectedPath) {
    let error;
    const fileManager = NSFileManager.defaultManager();

    this._outputPath = selectedPath + "/" + this.docName
  

    if (fileManager.fileExistsAtPath(this._outputPath)) {
      error = MOPointer.alloc().init();
      if(!fileManager.removeItemAtPath_error(this._outputPath,error)){
         log(error.value().localizedDescription());
      }
    }
    error = MOPointer.alloc().init();
    if (!fileManager.createDirectoryAtPath_withIntermediateDirectories_attributes_error(this._outputPath, false, null, error)) {
      log(error.value().localizedDescription());
    }       

    this.imagesPath = this._outputPath + "/" + Constants.IMAGES_DIRECTORY;
    if (!fileManager.fileExistsAtPath(this.imagesPath)) {
      error = MOPointer.alloc().init();
      if (!fileManager.createDirectoryAtPath_withIntermediateDirectories_attributes_error(this.imagesPath, false, null, error)) {
        log(error.value().localizedDescription());
      }
    } else {
      Utils.removeFilesWithExtension(this.imagesPath, "png");
    }
  }
}