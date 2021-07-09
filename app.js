var vertexShaderSource = `#version 300 es

// an attribute is an input (in) to a vertex shader.
// It will receive data from a buffer
in vec2 a_position;
in vec2 a_texCoord;

// Used to pass in the resolution of the canvas
uniform vec2 u_resolution;

// Used to pass the texture coordinates to the fragment shader
out vec2 v_texCoord;

// all shaders have a main function
void main() {

  // convert from 0->1 to 0->2
  vec2 zeroToTwo = a_position * 2.0;

  // convert from 0->2 to -1->+1 (clipspace)
  vec2 clipSpace = zeroToTwo - 1.0;

  gl_Position = vec4(clipSpace * vec2(1, -1), 0, 1);

  // pass the texCoord to the fragment shader
  // The GPU will interpolate this value between points.
  v_texCoord = a_texCoord;
}
`;

var fragmentShaderSource = `#version 300 es

// fragment shaders don't have a default precision so we need
// to pick one. highp is a good default. It means "high precision"
precision highp float;

#define PI 3.1415926538

// our texture
uniform sampler2D u_imageDay;
uniform sampler2D u_imageNight;
uniform vec2 u_resolution;

uniform float u_decl;
uniform float u_rA;
uniform float u_LST;

// the texCoords passed in from the vertex shader.
in vec2 v_texCoord;

// we need to declare an output for the fragment shader
out vec4 outColor;

float deg2rad(in float deg)
{
    return 2.0 * PI * deg / 360.0; 
}

float rad2deg(in float rad)
{
    return 360.0 * rad / (2.0 * PI);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord)
{
    // Transform coordinates to the range [-1, 1] x [-1, 1].
    vec2 uv = fragCoord / u_resolution.xy;

    // Transform to longitude and latitude.
    float longitude = (uv.x * 360.0) - 180.0;
    float latitude = (uv.y * 180.0) - 90.0;

    // Compute the sidereal time for the given longitude.
    float LSTlon = u_LST + longitude;

    // Hour angle.
    float h = deg2rad(LSTlon) - u_rA;

    // Perform transformation from Equitorial coordinate system to the horizontal coordinate system 
    // and convert to degrees from radians.
    float altitude = asin(cos(h)*cos(u_decl)*cos(deg2rad(latitude)) + sin(u_decl)*sin(deg2rad(latitude)));
    altitude = rad2deg(altitude);

    if (altitude > 0.0)
    {
        // Day. 
        fragColor = texture(u_imageDay, v_texCoord);
    }
    else if (altitude > -6.0)
    {
        // Civil twilight.
        fragColor = (0.5*texture(u_imageNight, v_texCoord) + 1.5*texture(u_imageDay, v_texCoord)) * 0.5;
    }
    else if (altitude > -12.0)
    {
        // Nautical twilight.
        fragColor = (texture(u_imageNight, v_texCoord) + texture(u_imageDay, v_texCoord)) * 0.5;
    }
    else if (altitude > -18.0)
    {
        // Astronomical twilight.
        fragColor = (1.5*texture(u_imageNight, v_texCoord) + 0.5*texture(u_imageDay, v_texCoord)) * 0.5;
    }
    else
    {
        // Night.
        fragColor = texture(u_imageNight, v_texCoord);
    }
}

void main() 
{
    //outColor =  0.5*texture(u_imageDay, v_texCoord) + 0.5*texture(u_imageNight, v_texCoord);
    mainImage(outColor, gl_FragCoord.xy);
}
`;

// Number of images loaded. Must reach two before initialization is performed.
var numLoaded = 0;

// Textures.
var imageDay = new Image();
var imageNight = new Image();
imageDay.src = "textures/2k_earth_daymap.jpg"; 
imageNight.src = "textures/2k_earth_nightmap.jpg";

// 2d and WebGL canvases stacked top of each other.
var canvasJs = document.getElementById("canvasJS");
var contextJs = canvasJs.getContext("2d");
var canvasGl = document.getElementById("canvasGL");
var gl = canvasGl.getContext("webgl2");

// DatGUI controls.
var guiControls = null;
var gui = null;

// Compiled shaders.
var program = null;

// Interval used for redrawing the visualization regularly.
var interval = null;

// Flag indicating whether sunrise and sunset times should be updated.
var updateSun = true;

// The most recent sunrise and sunset times.
var sunriseTime = null;
var sunsetTime = null;

// Flag indicating whether drawing of a frame is on-going. Used to block accumulation
// of requests from UI.
var drawing = false;

// Initialize after images have been loaded.
imageDay.onload = function() 
{
    numLoaded++;
    if (numLoaded == 2)
    {
      init();
    }
};

imageNight.onload = function() 
{
    numLoaded++;
    if (numLoaded == 2)
    {
        init();
    }
};

/**
 * Load texture.
 * 
 * @param {Number} index 
 * @param {Image} image The image to be loaded.
 * @param {WebGLUniformLocation} imageLocation Uniform location for the texture.
 */
function loadTexture(index, image, imageLocation)
{
    // Create a texture.
    var texture = gl.createTexture();

    gl.activeTexture(gl.TEXTURE0 + index);
    gl.bindTexture(gl.TEXTURE_2D, texture);

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.uniform1i(imageLocation, index);
}

/**
 * Create GUI controls.
 */
function createGui()
{
    guiControls = new function()
    {
        //this.preset = "Start";
        this.enableGrid = true;
        this.locationLon = 24.66;
        this.locationLat = 60.21;
        this.gridLonResolution = 30;
        this.gridLatResolution = 30;        
        this.enableSun = true;
        this.enableMoon = true;
        this.enableLocation = true;
        this.displayTwilight = true;
        this.deltaDays = 0;
        this.deltaHours = 0;
        this.deltaMins = 0;
        this.showLocal = true;
        this.showUtc = true;
        this.showJulian = true;
        this.showRa = true;
        this.showDecl = true;
        this.showSunLatitude = true;
        this.showSunLongitude = true;
    }

    gui = new dat.GUI();
    let displayFolder = gui.addFolder('Display');
    displayFolder.add(guiControls, 'enableGrid').onChange(requestFrame);

    let locationFolder = gui.addFolder('Location');
    let locLatControl = locationFolder.add(guiControls, 'locationLat', -90, 90, 0.01).onChange(requestFrameWithSun);
    let locLonControl = locationFolder.add(guiControls, 'locationLon', -180, 180, 0.01).onChange(requestFrameWithSun);

    locationFolder.add({fromGps:function()
    {
        tryUpdateGps();
        requestFrameWithSun();
    }}, 'fromGps');


    let lonControl = displayFolder.add(guiControls, 'gridLonResolution', 1, 180, 1).onChange(requestFrameWithSun);
    let latControl = displayFolder.add(guiControls, 'gridLatResolution', 1, 180, 1).onChange(requestFrameWithSun);
    displayFolder.add(guiControls, 'enableSun').onChange(requestFrame());
    displayFolder.add(guiControls, 'enableMoon').onChange(requestFrame());
    displayFolder.add(guiControls, 'enableLocation').onChange(requestFrame());
    
    let deltaFolder = gui.addFolder('DeltaTime');
    let dayControl = deltaFolder.add(guiControls, 'deltaDays', -185, 185, 1).onChange(requestFrameWithSun);
    let hourControl = deltaFolder.add(guiControls, 'deltaHours', -12, 12, 1).onChange(requestFrameWithSun);
    let minuteControl = deltaFolder.add(guiControls, 'deltaMins', -30, 30, 1).onChange(requestFrameWithSun);
    deltaFolder.add({reset:function()
        {
            dayControl.setValue(0);
            minuteControl.setValue(0);
            hourControl.setValue(0);
            requestFrameWithSun();
        }}, 'reset');
    
    let textFolder = gui.addFolder('Caption');
    textFolder.add(guiControls, 'showLocal').onChange(requestFrame);
    textFolder.add(guiControls, 'showUtc').onChange(requestFrame);
    textFolder.add(guiControls, 'showJulian').onChange(requestFrame);
    textFolder.add(guiControls, 'showRa').onChange(requestFrame);
    textFolder.add(guiControls, 'showDecl').onChange(requestFrame);
    textFolder.add(guiControls, 'showSunLongitude').onChange(requestFrame);
    textFolder.add(guiControls, 'showSunLatitude').onChange(requestFrame);
}

/**
 * Compile the WebGL program.
 * 
 * @returns The compiled program.
 */
function compileProgram()
{
    const vertexShader = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vertexShader, vertexShaderSource);
    gl.compileShader(vertexShader);

    const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fragmentShader, fragmentShaderSource);
    gl.compileShader(fragmentShader);

    if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS))
    {
        console.log("compile");
    }

    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    
    gl.linkProgram(program);
    // Check the link status
    const linked = gl.getProgramParameter(program, gl.LINK_STATUS);
    if (!linked) 
    {
        // error.
        gl.deleteProgram(program);
    }

    return program;
}

/**
 * Initialize.
 */
function init()
{
    program = compileProgram();
    gl.useProgram(program);

    var imageLocationDay = gl.getUniformLocation(program, "u_imageDay");
    var imageLocationNight = gl.getUniformLocation(program, "u_imageNight");

    loadTexture(0, imageDay, imageLocationDay);
    loadTexture(1, imageNight, imageLocationNight);
  
    createGui();
    
    window.addEventListener('resize', requestFrame, false);

    // Update location when the map is clicked.
    canvasJs.addEventListener('click', function(event)
    {
        guiControls.locationLon = xToLon(event.pageX);
        guiControls.locationLat = yToLat(event.pageY);
        requestFrameWithSun();
    });

    // Try to obtain location with the GPS.
    tryUpdateGps();

    // look up where the vertex data needs to go.
    var positionAttributeLocation = gl.getAttribLocation(program, "a_position");
    var texCoordAttributeLocation = gl.getAttribLocation(program, "a_texCoord");

    var vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    var positionBuffer = gl.createBuffer();
    gl.enableVertexAttribArray(positionAttributeLocation);
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.vertexAttribPointer(positionAttributeLocation, 2, gl.FLOAT, false, 0, 0);


    // Load Texture and vertex coordinate buffers. 
    var texCoordBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        0.0,  0.0,
        1.0,  0.0,
        0.0,  1.0,
        0.0,  1.0,
        1.0,  0.0,
        1.0,  1.0,
    ]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(texCoordAttributeLocation);
    gl.vertexAttribPointer(texCoordAttributeLocation, 2, gl.FLOAT, false, 0, 0);
  
    gl.bindVertexArray(vao);

    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        0.0, 0.0,
        1.0, 0.0,
        0.0, 1.0,
        0.0, 1.0,
        1.0, 0.0 ,
        1.0, 1.0,
    ]), gl.STATIC_DRAW);

    // Draw the first frame.
    requestFrameWithSun();
}

/**
 * Request frame if no drawing is on-going.
 */
function requestFrame() 
{
    // If drawing is on-going, skip. This is an attempt to avoid the situation, where 
    // drawing requests accumulate faster than can be processed due to UI callbacks.
    if (drawing)
    {
        return;
    }

    drawing = true;
    requestAnimationFrame(update);
}

/**
 * Request frame with recomputation of the sunrise and sunset times.
 */
function requestFrameWithSun() 
{
    updateSun = true;
    requestFrame();
}

/**
 * Try to update location from GPS.
 */
function tryUpdateGps()
{
    if (navigator.geolocation)
    {
        navigator.geolocation.getCurrentPosition(function(position) {
            guiControls.locationLon = position.coords.longitude;
            guiControls.locationLat = position.coords.latitude;
        });
    }    
}

/**
 * Map angle to the interval [0, 2*pi].
 *  
 * @param {Number} rad 
 *     The angle (in radians).
 * @returns The mapped angle.
 */
function limitAngle(rad)
{
    var interval = 2 * Math.PI;
    if (rad < 0)
    {
        rad += (1 + Math.floor(-rad / interval)) * interval;
    }
    else
    {
        rad = rad % interval;
    }
    return rad;
}

/**
 * Recompute sunrise and sunset times.
 * 
 * @param {Date} today Current time.
 * @param {SunAltitude} sunAltitude SunAltitude object for the computation.
 * @param {Number} JD Julian Date.
 * @param {Number} JT Julian Time.
 */
function updateSunriseSet(today, sunAltitude, JD, JT)
{
    let jtStep = 1e-4;
    var foo = sunAltitude.computeSunriseSet(today, JD, JT, jtStep, guiControls.locationLon, guiControls.locationLat);
    sunriseTime = foo.rise;
    sunsetTime = foo.set;
}

function lonToX(lon)
{
    return canvasJs.width * ((lon + 180.0) / 360.0);
}

function latToY(lat)
{
    return canvasJs.height * ((-lat + 90.0) / 180.0);
}

function xToLon(x)
{
    return (360.0 * (x - canvasJs.width / 2)) / canvasJs.width;
}

function yToLat(y)
{
    return -(180.0 * (y - canvasJs.height / 2)) / canvasJs.height;
}

/**
 * Draw Sun location and route.
 * 
 * @param {SunAltitude} sunAltitude 
 *     The SunAltitude object used for the computation.
 * @param {Number} rA 
 *     The right ascension of the Sun at JT.
 * @param {Number} decl 
 *     The declination of the Sun at JT.
 * @param {Number} JD 
 *     The Julian Day.
 * @param {Number} JT 
 *     The Julian Time.
 */
function drawSun(sunAltitude, rA, decl, JD, JT)
{
    lonlat = sunAltitude.computeSunLonLat(rA, decl, JD, JT);

    // Sun location on the Canvas.
    let x = lonToX(lonlat.lon);
    let y = latToY(lonlat.lat);

    // Draw Sun location.
    contextJs.beginPath();
    contextJs.arc(x, y, 10, 0, Math.PI * 2);
    contextJs.fillStyle = "#ffff00";
    contextJs.fill();

    contextJs.beginPath();
    contextJs.strokeStyle = '#ffff00';
    contextJs.font = "12px Arial";
    contextJs.fillStyle = "#ffff00";

    // Draw caption.
    let caption = lonlat.lat.toFixed(2).toString() + "° " + lonlat.lon.toFixed(2).toString() + "°";
    let textWidth = contextJs.measureText(caption).width;

    let captionShift =  x + 10 + textWidth - canvasJs.width;
    if (captionShift < 0)
    {
        captionShift = 0;
    }
    contextJs.fillText(caption, x+10 - captionShift, y-10);

    // Draw Sun path.
    for (jdDelta = -1.0; jdDelta < 1.0; jdDelta += 0.01)
    {
        lonlat = sunAltitude.computeSunLonLat(rA, decl, JD, JT + jdDelta);

        let x = lonToX(lonlat.lon);
        let y = latToY(lonlat.lat);

        if (jdDelta == -1.0)
        {
            contextJs.moveTo(x, y);
        }
        else
        {
            contextJs.lineTo(x, y);
        }
    }
    contextJs.stroke();
}

/**
 * Draw Moon location and route.
 * 
 * @param {MoonAltitude} moonAltitude 
 *     The SunAltitude object used for the computation.
 * @param {Number} rA 
 *     The right ascension of the Sun at JT.
 * @param {Number} decl 
 *     The declination of the Sun at JT.
 * @param {Number} JD 
 *     The Julian Day.
 * @param {Number} JT 
 *     The Julian Time.
 */
 function drawMoon(moonAltitude, rA, decl, JD, JT)
 {
     lonlat = moonAltitude.computeMoonLonLat(rA, decl, JD, JT);
 
     // Sun location on the Canvas.
     let x = lonToX(lonlat.lon);
     let y = latToY(lonlat.lat);
 
     // Draw Sun location.
     contextJs.beginPath();
     contextJs.arc(x, y, 10, 0, Math.PI * 2);
     contextJs.fillStyle = "#aaaaaa";
     contextJs.fill();
 
     contextJs.beginPath();
     contextJs.strokeStyle = '#aaaaaa';
     contextJs.font = "12px Arial";
     contextJs.fillStyle = "#aaaaaa";
 
     // Draw caption.
     /*let caption = lonlat.lat.toFixed(2).toString() + "° " + lonlat.lon.toFixed(2).toString() + "°";
     let textWidth = contextJs.measureText(caption).width;
 
     let captionShift =  x + 10 + textWidth - canvasJs.width;
     if (captionShift < 0)
     {
         captionShift = 0;
     }
     contextJs.fillText(caption, x+10 - captionShift, y-10);
     */
     // Draw Moon path.
     /*
     for (jdDelta = -1.0; jdDelta < 1.0; jdDelta += 0.01)
     {
         lonlat = moonAltitude.computeMoonLonLat(rA, decl, JD, JT + jdDelta);
 
         let x = lonToX(lonlat.lon);
         let y = latToY(lonlat.lat);
 
         if (jdDelta == -1.0)
         {
             contextJs.moveTo(x, y);
         }
         else
         {
             contextJs.lineTo(x, y);
         }
     }
     contextJs.stroke();*/
 }
 
/**
 * Convert date to HH:MM string.
 * 
 * @param {Date} date The date.
 * @returns The string.
 */
function getTimeString(date)
{
    if (date == null)
    {
        return "NA";
    }

    return ("0" + date.getHours()).slice(-2) + ":" + 
           ("0" + date.getMinutes()).slice(-2);
}

/**
 * Draw grid.
 */
function drawGrid()
{
    contextJs.font = "10px Arial";
    contextJs.fillStyle = "#777777";

    for (var lon = 0; lon <= 180.0; lon += guiControls.gridLonResolution)
    {
        var x = lonToX(lon);
        contextJs.beginPath();
        contextJs.moveTo(x, 0);
        contextJs.lineTo(x, canvasJs.height);

        contextJs.fillText(" " + lon.toString() + "°", x, 15);

        x = lonToX(-lon);
        contextJs.moveTo(x, 0);
        contextJs.lineTo(x, canvasJs.height);
        contextJs.strokeStyle = '#777777';
        contextJs.stroke();

        if (lon != 0)
        {
            contextJs.fillText(" -" + lon.toString() + "°", x, 15);
        }
    }
    x = canvasJs.width - 1;
    contextJs.moveTo(x, 0);
    contextJs.lineTo(x, canvasJs.height);
    contextJs.stroke();

    for (var lat = 0; lat <= 90.0; lat += guiControls.gridLatResolution)
    {
        var y = latToY(lat);
        contextJs.beginPath();
        contextJs.moveTo(0, y);
        contextJs.lineTo(canvasJs.width, y);

        contextJs.fillText(" " + lat.toString() + "°", 0, y - 5);

        y = latToY(-lat);
        contextJs.moveTo(0, y);
        contextJs.lineTo(canvasJs.width, y);
        contextJs.strokeStyle = '#777777';
        contextJs.stroke();

        if (lat != 0)
        {
            contextJs.fillText(" -" + lat.toString() + "°", 0, y - 5);
        }
    }
    y = canvasJs.height - 1;
    contextJs.beginPath();
    contextJs.moveTo(0, y);
    contextJs.lineTo(canvasJs.width, y);
    contextJs.stroke();

    var x = lonToX(0);
    contextJs.moveTo(x, 0);
    contextJs.lineTo(x, canvasJs.height);
    contextJs.strokeStyle = '#ffffff';
    contextJs.stroke();    

    var y = latToY(0);
    contextJs.moveTo(0, y);
    contextJs.lineTo(canvasJs.width, y);
    contextJs.strokeStyle = '#ffffff';
    contextJs.stroke();
}

/**
 * Draw location.
 * 
 * @param {Number} date The Sun altitude.
 */
function drawLocation(altitude)
{
    let x = lonToX(guiControls.locationLon);
    let y = latToY(guiControls.locationLat);
    contextJs.beginPath();
    contextJs.fillStyle = "#ffff00";
    contextJs.moveTo(x, y - 5);
    contextJs.lineTo(x, y + 5);
    contextJs.moveTo(x - 5, y);
    contextJs.lineTo(x + 5, y);
    contextJs.stroke();

    contextJs.font = "12px Arial";
    contextJs.fillStyle = "#ffff00";

    let caption = "Location: " + guiControls.locationLat.toFixed(2).toString() + "° " + 
        guiControls.locationLon.toFixed(2).toString() + "°";
    contextJs.fillText(caption, x+10, y-36);
    contextJs.fillText("Altitude: " + altitude.toFixed(3) + "°", x+10, y-24);
    contextJs.fillText("Rise: " + getTimeString(sunriseTime), x+10, y-12);
    contextJs.fillText("Set: " + getTimeString(sunsetTime), x+ 10, y);
}

/**
 * Redraw the map and the contour according to the Sun altitude.
 */
function update()
{
    if (interval != null)
    {
        clearInterval(interval);
        interval = null;
    }

    // Adjust the canvas height according to the body size and the height of the time label.
    var body = document.getElementsByTagName('body')[0];

    canvasGL.width = document.documentElement.clientWidth;
    canvasGL.height = document.documentElement.clientHeight;
    canvasJs.width = document.documentElement.clientWidth;
    canvasJs.height = document.documentElement.clientHeight;

    // Compute Julian time.
    var today = new Date(new Date().getTime() 
    + 24 * 3600 * 1000 * guiControls.deltaDays
    + 3600 * 1000 * guiControls.deltaHours
    + 60 * 1000 * guiControls.deltaMins);

    julianTimes = TimeConversions.computeJulianTime(today);
    JD = julianTimes.JD;
    JT = julianTimes.JT;
    JDref = Math.ceil(TimeConversions.computeJulianDay(2000, 1, 1));

    // Compute equitorial coordinates of the Sun.
    var sunAltitude = new SunAltitude();
    var eqCoords = sunAltitude.computeEquitorial(JT);
    var rA = eqCoords.rA;
    var decl = eqCoords.decl;

    // Compute equitorial coordinates of the Moon.
    var moonAltitude = new MoonAltitude();
    var eqCoordsMoon = moonAltitude.computeEquitorial(JT);
    var rAMoon = eqCoordsMoon.rA;
    var declMoon = eqCoordsMoon.decl;


    // Compute sidereal time perform modulo to avoid floating point accuracy issues with 32-bit
    // floats in the shader:
    var LST = TimeConversions.computeSiderealTime(0, JD, JT) % 360.0;

    //console.log("Right Ascension : " + Coordinates.rad2Deg(rA) + " deg ");
    //console.log("Declination     : " + Coordinates.rad2Deg(decl) + " deg");
    
    // Update computational parameter uniforms.
    var raLocation = gl.getUniformLocation(program, "u_rA");
    var declLocation = gl.getUniformLocation(program, "u_decl");
    var lstLocation = gl.getUniformLocation(program, "u_LST");

    gl.uniform1f(raLocation, rA);
    gl.uniform1f(declLocation, decl);
    gl.uniform1f(lstLocation, LST);

    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

    // Update canvas size uniform.
    var resolutionLocation = gl.getUniformLocation(program, "u_resolution");
    gl.uniform2f(resolutionLocation, gl.canvas.width, gl.canvas.height);

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 6);


    /////////////////////////////////////////////////////

    let dateText = document.getElementById('dateText');

    let caption = "";
    lonlat = sunAltitude.computeSunLonLat(rA, decl, JD, JT);
    let altitude = sunAltitude.computeAltitude(rA, decl, JD, JT, guiControls.locationLon, guiControls.locationLat);

    if (guiControls.showLocal)
    {
        caption = caption + "Local: " + today.toString() + "<br>";
    }
    if (guiControls.showUtc)
    {
        caption = caption + "UTC: " + today.toUTCString() + "<br>";
    } 
    if (guiControls.showJulian)
    {
        caption = caption + "Julian: " + JT.toString() + "<br>";
    }
    if (guiControls.showRa)
    {
        let raTime = Coordinates.deg2Time(Coordinates.rad2Deg(rA));
        caption = caption + "RA: " + raTime.h + "h " + raTime.m + "m " + raTime.s + "s (" +
                Coordinates.rad2Deg(rA).toFixed(5) + "&deg;) <br>";
    }
    if (guiControls.showDecl)
    {
        caption = caption + "Declination: " + Coordinates.rad2Deg(decl).toFixed(5) + "&deg; <br>";
    }
    if (guiControls.showSunLongitude)
    {
        caption = caption + "Sun Longitude: " + lonlat.lon.toFixed(5) + "&deg; <br>";
    }
    if (guiControls.showSunLatitude)
    {
        caption = caption + "Sun Latitude: " + lonlat.lat.toFixed(5) + "&deg; <br>";
    }

    dateText.innerHTML = "<p>" + caption + "</p>";

    if (updateSun)
    {
       updateSunriseSet(today, sunAltitude, JD, JT);   
       updateSun = false;
    }

    if (guiControls.enableGrid)
    {
        drawGrid();
    }
    if (guiControls.enableSun)
    {
        drawSun(sunAltitude, rA, decl, JD, JT);
    }
    if (guiControls.enableMoon)
    {
        drawMoon(moonAltitude, rAMoon, declMoon, JD, JT);
    }
    if (guiControls.enableLocation)
    {
        drawLocation(altitude);
    }

    if (interval == null)
    {
        interval = setInterval(function() {requestFrame();}, 100);
    }

    drawing = false;
}