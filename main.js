let canvas;
let rect;
let gl;

const maxNumTriangles = 200;
const maxNumVertices = 3 * maxNumTriangles;
const maxSnapshotCount = 5;

let lastMouseInX = 0;
let lastMouseInY = 0;
let inX1 = 0;
let inY1 = 0;
let inX2 = 0;
let inY2 = 0;


let universalZoomScaleInt = 100; //Divide by 100.0 on scale
let zoomChange = 10;
let universalCanvasShiftInt = vec2(0,0);
let canvasShiftChange = 10; //Out of 100

let snapshotList = [];
let selectedPolygonList = [];

let cIndex = 0;
let in1, in2, in3, in4 = vec2(0, 0);

let selectedAction;
let colorMenu;

const colors = [
    vec4(0.0, 0.0, 0.0, 1.0),  // black
    vec4(1.0, 0.0, 0.0, 1.0),  // red
    vec4(1.0, 1.0, 0.0, 1.0),  // yellow
    vec4(0.0, 1.0, 0.0, 1.0),  // green
    vec4(0.0, 0.0, 1.0, 1.0),  // blue
    vec4(1.0, 0.0, 1.0, 1.0),  // magenta
    vec4(0.0, 1.0, 1.0, 1.0),  // cyan
    vec4(1.0, 1.0, 1.0, 1.0)   // white
];
const indicatorColor = vec4(1.0,0.65,0.0,1); //bright orange

let vBuffer;
let cBuffer;
let program;
let selector;

let idRGBAConvert;
let pixel;

//Frame buffer implementation of polygon index - RGBA transformations
class ColorToID{
    redBits = gl.getParameter(gl.RED_BITS);
    greenBits = gl.getParameter(gl.GREEN_BITS);
    blueBits = gl.getParameter(gl.BLUE_BITS);
    alphaBits = gl.getParameter(gl.ALPHA_BITS);

    redShift = Math.pow(2, this.greenBits + this.blueBits + this.alphaBits);
    greenShift = Math.pow(2, this.blueBits + this.alphaBits);
    blueShift = Math.pow(2, this.alphaBits);

    color = new Float32Array(4);

    //Get integer ID for a given RGBA value
    getID(r, g, b, a) {
        // Shift each component to its bit position in the integer
        return (r * this.redShift + g * this.greenShift + b * this.blueShift + a);
    }

    //Get RGBA value from given id
    createColor(id) {
        let r, g, b, a;

        r = Math.floor(id / this.redShift);
        id = id - (r * this.redShift);

        g = Math.floor(id / this.greenShift);
        id = id - (g * this.greenShift);

        b = Math.floor(id / this.blueShift);
        id = id - (b * this.blueShift);

        a = id;

        this.color[0] = r / (Math.pow(2, this.redBits) - 1);
        this.color[1] = g / (Math.pow(2, this.greenBits) - 1);
        this.color[2] = b / (Math.pow(2, this.blueBits) - 1);
        this.color[3] = a / (Math.pow(2, this.alphaBits) - 1);

        return this.color;
    }
}

class Polygon {
    constructor(listOfVertices, color) {
        this.listOfVertices = listOfVertices;
        this.color = color;
    }
}

class Snapshot {
    constructor(listOfPolygons) {
        this.listOfPolygons = listOfPolygons;
    }
}

window.onload = function init() {
    canvas = document.getElementById("gl-canvas");
    colorMenu = document.getElementById("color-menu");
    gl = WebGLUtils.setupWebGL(canvas);
    if (!gl) { alert("WebGL isn't available"); }

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0.8, 0.8, 0.8, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    //
    //  Load shaders and initialize attribute buffers
    //
    program = initShaders(gl, "vertex-shader", "fragment-shader");
    selector = initShaders(gl, "vertex-shader", "fragment-shader");
    gl.useProgram(program);

    //Initialize the frame buffer manager
    idRGBAConvert = new ColorToID;
    pixel = new Uint8Array(4);

    vBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, 8 * maxNumVertices, gl.STATIC_DRAW);

    const vPosition = gl.getAttribLocation(program, "vPosition");
    gl.vertexAttribPointer(vPosition, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(vPosition);

    cBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, cBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, 16 * maxNumVertices, gl.STATIC_DRAW);

    const vColor = gl.getAttribLocation(program, "vColor");
    gl.vertexAttribPointer(vColor, 4, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(vColor);

    console.log(colorMenu);
    console.log(canvas);

    colorMenu.addEventListener("click", function () {
        cIndex = colorMenu.selectedIndex;
    });

    rect = canvas.getBoundingClientRect();

    //Mouse down confirms selected action in UI and inputs the first XY coordinates on canvas
    canvas.addEventListener("mousedown", function (event) {
        selectedAction = document.querySelector( 'input[name="action-select"]:checked');
        rect = canvas.getBoundingClientRect();
        in1 = vec2(2*(event.clientX - rect.left)/canvas.width-1,
            2*(canvas.height-(event.clientY - rect.top))/canvas.height-1);
        inX1 = event.clientX;
        inY1 = event.clientY;
    }
    );

    //Mouse up passes the second set of XY coordinates to the variables and performs some action
    //that is not tied directly to events
    //(All functionality not included in performAction is tied to event listeners)
    canvas.addEventListener("mouseup", function (event) {
        in3 = vec2(2*(event.clientX - rect.left)/canvas.width-1,
            2*(canvas.height-(event.clientY - rect.top))/canvas.height-1);

        inX2 = event.clientX;
        inY2 = event.clientY;
        performAction();
        renderAllVertices(currSnapshot, selectedPolygonList);
        //console.log(currSnapshot);
    }
    );

    canvas.addEventListener('mousemove', function(event) {
        lastMouseInX = event.clientX;
        lastMouseInY = event.clientY;
    });

    document.addEventListener('keydown', function(event) {
        if (event.ctrlKey && event.key === 'c') {
            copyPolygons();
        }
    });

    //Pastes everything to the mouse point, where the average of all polygons is on the mouse coordinates
    document.addEventListener('keydown', function(event) {
        if (event.ctrlKey && event.key === 'v') {
            let inPaste = vec2(2*(lastMouseInX - rect.left)/canvas.width-1,
                2*(canvas.height-(lastMouseInY - rect.top))/canvas.height-1);

            let shift;
            let avgList = []
            for (let i = 0; i < selectedPolygonList.length; i++) {
                avgList.push(currSnapshot.listOfPolygons[selectedPolygonList[i]]);
                console.log(currSnapshot.listOfPolygons[selectedPolygonList[i]]);
            }
            shift = subtract(inPaste,returnAvgCenter(avgList));

            console.log(shift);

            if (shift !== null)
                pastePolygons(shift);
            renderAllVertices(currSnapshot,selectedPolygonList);
        }
    });

    //Zoom and pan values are changed here
    //The actual scaling and shifting operations take place every time a polygon is created or rendered
    document.addEventListener('keydown', function(event) {
        if (event.shiftKey && event.location === 2) {
            universalZoomScaleInt += zoomChange;
            renderAllVertices(currSnapshot,selectedPolygonList);
        }else if (event.ctrlKey && event.location === 2) {
            universalZoomScaleInt -= zoomChange;
            renderAllVertices(currSnapshot,selectedPolygonList);
        }
        console.log(universalZoomScaleInt);
    });

    document.addEventListener('keydown', function(event) {
        switch (event.key) {
            case "ArrowLeft":
                // Left pressed
                universalCanvasShiftInt = add(universalCanvasShiftInt, vec2(canvasShiftChange,0));
                renderAllVertices(currSnapshot,selectedPolygonList);
                break;
            case "ArrowRight":
                // Right pressed
                universalCanvasShiftInt = add(universalCanvasShiftInt, vec2(-1*canvasShiftChange,0));
                renderAllVertices(currSnapshot,selectedPolygonList);
                break;
            case "ArrowUp":
                // Up pressed
                universalCanvasShiftInt = add(universalCanvasShiftInt, vec2(0,-1*canvasShiftChange));
                renderAllVertices(currSnapshot,selectedPolygonList);
                break;
            case "ArrowDown":
                // Down pressed
                universalCanvasShiftInt = add(universalCanvasShiftInt, vec2(0,canvasShiftChange));
                renderAllVertices(currSnapshot,selectedPolygonList);
                break;
        }

        console.log(universalCanvasShiftInt);
    });


    //renderAllVertices is the function that refreshes the canvas
    const buttonsThatRender = document.getElementsByClassName("perform-render");
    for (const element of buttonsThatRender) {
        element.addEventListener("click",function () {
            renderAllVertices(currSnapshot, selectedPolygonList);

        });
    }

}



let currPolygon = new Polygon([], cIndex);
let currSnapshot = new Snapshot([]);
let currSnapshotBackup = new Snapshot([]);


function performAction()
{

    //Add rectangle
    if (selectedAction != null && selectedAction.value === "add-shape-rectangle") {
        if (in1 != null && in3 != null)
        {
            storeSwitchSnapshot();
            selectedPolygonList = [];
            currPolygon = returnRectangle(in1,in3);
            currPolygon = scalePolygon(currPolygon, 100.0/universalZoomScaleInt);
            currPolygon = movePolygon(currPolygon,vec2(universalCanvasShiftInt[0] / 100.0 * -1, universalCanvasShiftInt[1] / 100.0 * -1));
            currSnapshot.listOfPolygons.push(deepCopy(currPolygon));
            currPolygon = new Polygon([],cIndex);
        }
    }

    //Add triangle
    if (selectedAction != null && selectedAction.value === "add-shape-triangle") {
        if (in1 != null && in3 != null)
        {
            storeSwitchSnapshot();
            selectedPolygonList = [];
            currPolygon = returnTriangle(in1,in3);
            currPolygon = scalePolygon(currPolygon, 100.0/universalZoomScaleInt);
            currPolygon = movePolygon(currPolygon,vec2(universalCanvasShiftInt[0] / 100.0 * -1, universalCanvasShiftInt[1] / 100.0 * -1));
            currSnapshot.listOfPolygons.push(deepCopy(currPolygon));
            currPolygon = new Polygon([],cIndex);
        }

    }


    if (selectedAction != null && selectedAction.value === "draw-polygon") {
        selectedPolygonList = [];
        addVertex(in1);
    }

    //Select polygons
    if (selectedAction != null && selectedAction.value === "select-polygons") {
        selectFromClick(inX1,inY1);
    }

    //Move shape
    if (selectedAction != null && selectedAction.value === "move-shape") {
        storeSwitchSnapshot();
        //Refresh selected polygons list before and after action
        for (let i = 0; i < selectedPolygonList.length; i++) {
            console.log("move");
            currSnapshot.listOfPolygons[i] = movePolygon(currSnapshot.listOfPolygons[i], (subtract(in3, in1)));
        }
        renderAllVertices(currSnapshot,selectedPolygonList);
    }

    //Delete shape
    if (selectedAction != null && selectedAction.value === "delete-shape") {
        storeSwitchSnapshot();
        selectedPolygonList = [];
        selectFromClick(inX1,inY1);
        removeListedPolygon(currSnapshot.listOfPolygons[selectedPolygonList[0]]);
        selectedPolygonList = [];

    }
}

//Add polygon
const endPolyBtn = document.getElementById("end-polygon");
if (endPolyBtn != null) {
    endPolyBtn.addEventListener("click", function () {
        //Finish currPolygon and push it to snapshot array
        storeSwitchSnapshot();
        currPolygon.color = cIndex;
        //When creating a polygon, perform an inverse shift and zoom operation
        //So that the data in currSnapshot is the TRUE polygon
        //Devoid of shift or zoom
        currPolygon = scalePolygon(currPolygon, 100.0/universalZoomScaleInt);
        currPolygon = movePolygon(currPolygon,vec2(universalCanvasShiftInt[0] / 100.0 * -1, universalCanvasShiftInt[1] / 100.0 * -1));
        currSnapshot.listOfPolygons.push(deepCopy(currPolygon));
        currPolygon = new Polygon([], cIndex);
    });
}

let rotAmnt = 0;
const rotText = document.getElementById("rotation-angle");

const rotLeft = document.getElementById("rotate-left");
const rotRight = document.getElementById("rotate-right");

if (rotLeft != null) {
    rotLeft.addEventListener("click", function () {
        storeSwitchSnapshot();
        rotAmnt = parseInt(rotText.value);
        //Rotate left by amnt
        rotatePolygons(selectedPolygonList, rotAmnt);
    });
}

if (rotRight != null) {
    rotRight.addEventListener("click", function () {
        storeSwitchSnapshot();
        rotAmnt = parseInt(rotText.value);
        //Rotate right by amnt
        rotatePolygons(selectedPolygonList, rotAmnt * -1);

    });
}

//Undo - Redo
const undoBtn = document.getElementById("undo");
const redoBtn = document.getElementById("redo");

let undoIndex = 0;

//For the first undo in the list, the current snapshot is saved to a temp value
//Instead of being kept in the list
//(This is just how it is implemented, a 6 index long list could have also been used, but I chose to keep them separate)
if (undoBtn != null) {
    undoBtn.addEventListener("click", function(){
        console.log("undo in: " + undoIndex);
        if (undoIndex === 0) {
            currSnapshotBackup = deepCopy(currSnapshot);
        }
        if (undoIndex < snapshotList.length) {
            undoIndex++;

            currSnapshot = snapshotList[snapshotList.length - undoIndex];
            console.log(snapshotList);
            console.log(snapshotList[snapshotList.length - undoIndex]);

        }
        console.log("undo out: " + undoIndex);
    });
}

//Put the temp value back into currsnapshot for the last redo
if (redoBtn != null) {
    redoBtn.addEventListener("click", function(){
        if (undoIndex === 1) {
            currSnapshot = deepCopy(currSnapshotBackup);
            undoIndex--;
        }

        if (undoIndex > 0) {
            console.log("redo in: " + undoIndex);
            undoIndex--;
            console.log("val: " + (snapshotList.length - undoIndex));
            console.log(snapshotList);
            console.log(snapshotList[snapshotList.length - undoIndex]);
            currSnapshot = snapshotList[snapshotList.length - undoIndex];
        }

        console.log("redo out: " + undoIndex);
    });
}

//Copy-Paste
let polygonClipboard = [];

function copyPolygons()
{
    polygonClipboard = [];
    let l =  [];
    for (let i = 0; i < selectedPolygonList.length; i++) {
        l.push(currSnapshot.listOfPolygons[selectedPolygonList[i]]);
    }
    polygonClipboard.push.apply(polygonClipboard,l);
}

function pastePolygons(pasteShift)
{
    storeSwitchSnapshot();
    let newPaste = [];
    for (let i = 0; i < polygonClipboard.length; i++) {
        newPaste.push(movePolygon(polygonClipboard[i], pasteShift));
    }
    //Deep copy is not necessary here, it happens automatically when apply is called
    currSnapshot.listOfPolygons.push.apply(currSnapshot.listOfPolygons, newPaste);

    //polygonClipboard = [];
}

//Save - Load
const saveBtn = document.getElementById("save");
const loadFile = document.getElementById("load-file");


if (saveBtn != null) {
    saveBtn.addEventListener("click", function(){
        if ("showSaveFilePicker" in window)
            saveFile(currSnapshot);
        else
            downloadFile(currSnapshot);

        console.log("saving");
    });
}


//This is a very odd workaround
//Essentially, I have a "browse file" type input set as invisible in the HTML file
//When the load button is pressed, it simulates clicking on that browse file button instead
//This simply so that the load and save buttons look the same, there is no other use for this workaround
if (loadFile != null) {
    loadFile.addEventListener("change", function(){
        const jsonFile = loadFile.files[0];
        let fr = new FileReader();
        fr.onload = receivedText;
        fr.readAsText(jsonFile);

        //Get the json lines from the file and turn it back into a list of objects
        function receivedText(e) {
            let lines = e.target.result;
            const loadedList = JSON.parse(lines);
            currSnapshot = deepCopy(loadedList);
            currSnapshotBackup = currSnapshot;
            snapshotList = []; //Reset undo list. Not strictly necessary, but it is better to be consistent
            selectedPolygonList = [];
            polygonClipboard = [];
            universalCanvasShiftInt = vec2(0,0);
            universalZoomScaleInt = 100;
            renderAllVertices(currSnapshot, selectedPolygonList);
        }
    });
}

function renderAllVertices(snapshot,selectedP)
{

    if (snapshot === null)
        return;
    if (snapshot.listOfPolygons.length === 0) {
        gl.clear(gl.COLOR_BUFFER_BIT);
        return;
    }

    let pList = snapshot.listOfPolygons;
    let vList = null;
    let selectColor = vec4(0,0,0,0);
    let count = 0;

    //The inverse zoom and shift actions are undone here according to the universal constants
    //Thus, the user views the canvas according to their zoom and pan inputs
    for (let i = 0; i < pList.length; i++) {
        let pRendered = scalePolygon(pList[i],universalZoomScaleInt / 100.0);
        pRendered = movePolygon(pRendered,vec2(universalCanvasShiftInt[0] / 100.0, universalCanvasShiftInt[1] / 100.0));
        vList = pRendered.listOfVertices;
        selectColor = idRGBAConvert.createColor(i); //Set a select color for polygon according to its index on the list
        for (let j = 0; j < vList.length; j++) {

            let t = vList[j];

            gl.bindBuffer( gl.ARRAY_BUFFER, vBuffer );
            gl.bufferSubData(gl.ARRAY_BUFFER, 8 * count, flatten(t));

            t = vec4(colors[pList[i].color]);
            if (gl.getParameter(gl.CURRENT_PROGRAM) === selector)
                t = selectColor; //If selection is in effect, render everything with their select color

            gl.bindBuffer( gl.ARRAY_BUFFER, cBuffer );
            gl.bufferSubData(gl.ARRAY_BUFFER, 16 * count, flatten(t));

            count++;
        }
    }

    //If polygon at index is selected, add a line loop with the same vertices on top of polygon
    if (gl.getParameter(gl.CURRENT_PROGRAM) === program) {
        for (let i = 0; i < selectedP.length; i++) {
            let pIndicated = scalePolygon(pList[selectedP[i]], universalZoomScaleInt / 100.0);
            pIndicated = movePolygon(pIndicated, vec2(universalCanvasShiftInt[0] / 100.0, universalCanvasShiftInt[1] / 100.0));
            vList = pIndicated.listOfVertices;
            for (let j = 0; j < vList.length; j++) {

                let t = vList[j];

                gl.bindBuffer(gl.ARRAY_BUFFER, vBuffer);
                gl.bufferSubData(gl.ARRAY_BUFFER, 8 * count, flatten(t));

                //Inverse color is white
                t = indicatorColor;

                gl.bindBuffer(gl.ARRAY_BUFFER, cBuffer);
                gl.bufferSubData(gl.ARRAY_BUFFER, 16 * count, flatten(t));

                count++;
            }
        }
    }

    render();
}
//This is used to move the buffer a certain number of vertices forward
let bufferForward = 0;

function render()
{
    gl.clear( gl.COLOR_BUFFER_BIT );
    bufferForward = 0;
    for (let i = 0; i < currSnapshot.listOfPolygons.length; i++) {
        gl.drawArrays( gl.TRIANGLE_FAN, bufferForward, currSnapshot.listOfPolygons[i].listOfVertices.length);
        bufferForward += currSnapshot.listOfPolygons[i].listOfVertices.length;
    }
    //If polygon at index is selected, DRAW a line loop with the same vertices on top of polygon
    //These lines are drawn OVER the polygons, so that they can still be visible regardless of Z order
    for (let i = 0; i < selectedPolygonList.length; i++) {
        gl.drawArrays( gl.LINE_LOOP, bufferForward, currSnapshot.listOfPolygons[selectedPolygonList [i]].listOfVertices.length);
        bufferForward += currSnapshot.listOfPolygons[selectedPolygonList[i]].listOfVertices.length;
    }
}

//These are the functions for creating and manipulating polygons
function returnRectangle(in1, in3) {
    in2 = vec2(in3[0], in1[1]);
    in4 = vec2(in1[0], in3[1]);
    return new Polygon([in1, in2, in3, in4], cIndex);
}

function returnTriangle(in1, in3) {
    let in1Copy = vec2(in1[0], in1[1]);
    in1 = vec2(in1Copy[0], in3[1]);
    let h = (Math.abs(in3[0] - in1Copy[0]) * Math.sqrt(3) / 2.0); //get height from floor length
    in2 = vec2((in1Copy[0] + in3[0]) / 2.0, (h + in3[1]));


    return new Polygon([in1, in2, in3], cIndex);
}

function addVertex(v) {
    currPolygon.listOfVertices.push(deepCopy(v));
}

//Returns moved polygon
function movePolygon(polygonIn, shift)
{
    let newP = new Polygon([], 0);
    for (const element of polygonIn.listOfVertices) {
        newP.listOfVertices.push(add(element,shift));
    }
    newP.color = polygonIn.color;
    return newP;
}

//Returns new list
function removeListedPolygon(pToRemove) {
    let pList = currSnapshot.listOfPolygons;
    for (let i = 0; i < pList.length; i++) {
        if (pList[i] === pToRemove) {
            pList.splice(i, 1);
            break;
        }
    }
    return pList;
}

function rotatePolygons(polygonIndexesIn, angle)
{
    angle = radians(angle);

    for (let i = 0; i < polygonIndexesIn.length; i++) {
        const pReturn = new Polygon([], 0);
        let p = currSnapshot.listOfPolygons[polygonIndexesIn[i]];

        let center = returnPolygonCenter(p);
        for (const vertex of p.listOfVertices) {
            //Translate to origin
            let x1 = vertex[0] - center[0];
            let y1 = vertex[1] - center[1];

            //Apply rotation
            let tempX = x1 * Math.cos(angle) - y1 * Math.sin(angle);
            let tempY = x1 * Math.sin(angle) + y1 * Math.cos(angle);


            pReturn.listOfVertices.push(vec2(tempX + center[0], tempY + center[1]));
        }
        pReturn.color = p.color;
        //Replace polygons at selected indices with the rotated ones
        currSnapshot.listOfPolygons[polygonIndexesIn[i]] = deepCopy(pReturn);
    }
}

function scalePolygon(pIn, scaleF, uniform = false)
{
    const pReturn = new Polygon([], 0);

    let center = returnPolygonCenter(pIn);

    //Scaling is non-uniform by default
    for (const vertex of pIn.listOfVertices) {
        if (uniform) {
            //Translate to origin
            let x1 = vertex[0] - center[0];
            let y1 = vertex[1] - center[1];

            //Apply scaling
            let tempX = x1 * scaleF;
            let tempY = y1 * scaleF;

            pReturn.listOfVertices.push(vec2(tempX + center[0], tempY + center[1]));
        }else {
            //Apply scaling
            let x = vertex[0] * scaleF;
            let y = vertex[1] * scaleF;

            pReturn.listOfVertices.push(vec2(x, y));
        }
    }
    pReturn.color = pIn.color;
    return pReturn;
}


function returnPolygonCenter(polygon)
{
    let xSum = 0;
    let ySum = 0;
    let center = vec2(0, 0);

    for (const vertex of polygon.listOfVertices) {
        xSum += vertex[0];
        ySum += vertex[1];
    }

    center[0] = xSum / polygon.listOfVertices.length;
    center[1] = ySum / polygon.listOfVertices.length;

    return center;
}

function returnAvgCenter(list)
{
    let centerAvg = vec2(0,0);
    for (const p of list) {
        centerAvg = add(centerAvg,returnPolygonCenter(p));
    }
    centerAvg[0] = centerAvg[0] / list.length;
    centerAvg[1] = centerAvg[1] / list.length;

    return centerAvg;
}

function deepCopy(objIn)
{
    return structuredClone(objIn)
}
//NOTICE: selectedPolygonList stores index of polygons
function selectFromClick(mouseX, mouseY)
{
    //Render with the selector program
    gl.useProgram(selector);
    renderAllVertices(currSnapshot,selectedPolygonList);

    //Translate "origin at center" canvas coordinates to readPixel coordinates
    mouseX = mouseX - rect.left;
    mouseY = mouseY - rect.top;
    mouseY = canvas.clientHeight - mouseY;
    gl.readPixels(mouseX, mouseY, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    let selectedP = idRGBAConvert.getID(pixel[0], pixel[1], pixel[2], pixel[3]);
    if (selectedP < currSnapshot.listOfPolygons.length)
        selectedPolygonList.push(selectedP);
    else
        selectedPolygonList = [];
    gl.useProgram(program);
    renderAllVertices(currSnapshot,selectedPolygonList);
    //if click doesn't hit a polygon, deselect all


}

//This function is called BEFORE any operation that affects the list of undo-redo operations
function storeSwitchSnapshot()
{
    let reducedList = [];
    if (undoIndex > 0)
    {
        for (let i = 0; i < snapshotList.length - undoIndex; i++) {
            reducedList[i] = deepCopy(snapshotList[i]);
        }
        snapshotList = deepCopy(reducedList);
        undoIndex = 0;
    }

    snapshotList.push(deepCopy(currSnapshot));
    //Shift list if new snapshot exceeds list size limit (default limit = 5)
    if (snapshotList.length > maxSnapshotCount) {
        console.log("exceeded");
        let newList = [];
        for (let i = 1; i < snapshotList.length; i++) {
            newList[i - 1] = deepCopy(snapshotList[i]);
        }
        snapshotList = deepCopy(newList);
    }

}

//This function is called if the file picker for saving the canvas is not available on the browser
function downloadFile(content, fileName, contentType = "application/json") {
    fileName = window.prompt("Enter the name for your save file:");

    if (fileName.search(".json") === -1)
        fileName = fileName + ".json";
    if (fileName.length === 0)
        fileName = "save.json";

    const file = new Blob([JSON.stringify(content)], {type: contentType});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(file);
    a.setAttribute("download", fileName);
    document.body.appendChild(a);
    console.log(a);
    a.click();
    setTimeout(function () {
        document.body.removeChild(a);
        window.URL.revokeObjectURL(a.href);
    }, 0);

}
//This function is called if the default file picker for your operating system can be shown
async function saveFile(content) {
    const contentType = 'application/json';

    const opts = {
        types: [
            {
                description: 'JSON file',
                accept: {
                    'application/json' : ['.json'],
                },
            },
        ],
    };

    //Get handle and write stream
    const newHandle = await window.showSaveFilePicker(opts);
    const writableStream = await newHandle.createWritable();

    //Get file
    const file = new Blob([JSON.stringify(content)], {type: contentType});

    //Write
    await writableStream.write(file);

    //Close and write to disk
    await writableStream.close();
}




