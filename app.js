var container;
var camera, scene, renderer;
var uniforms;

var guiControls = null;
var gui = null;
var grid = null;
var texture1 = null;

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

  // convert the position from pixels to 0.0 to 1.0
  vec2 zeroToOne = a_position / u_resolution;

  // convert from 0->1 to 0->2
  vec2 zeroToTwo = zeroToOne * 2.0;

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

var numLoaded = 0;
var initialized = false;

var imageDay = new Image();
var imageNight = new Image();
imageDay.src = "textures/2k_earth_daymap.jpg"; 
imageNight.src = "textures/2k_earth_nightmap.jpg";

var canvasJs = document.getElementById("canvasJS");
var contextJs = canvasJs.getContext("2d");

var canvasGl = document.getElementById("canvasGL");
var gl = canvasGl.getContext("webgl2");

var program = null;
var interval = null;

//init();
//animate();

function lonToX(lon)
{
    return canvasJs.width * ((lon + 180.0) / 360.0);
}

function latToY(lat)
{
    return canvasJs.height * ((-lat + 90.0) / 180.0);
}

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

    // Upload the image into the texture.
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.uniform1i(imageLocation, index);
}

function init()
{
    // setup GLSL program
    program = webglUtils.createProgramFromSources(gl, [vertexShaderSource, fragmentShaderSource]);
    gl.useProgram(program);

    var imageLocationDay = gl.getUniformLocation(program, "u_imageDay");
    var imageLocationNight = gl.getUniformLocation(program, "u_imageNight");

    loadTexture(0, imageDay, imageLocationDay);
    loadTexture(1, imageNight, imageLocationNight);
  
    guiControls = new function()
    {
        //this.preset = "Start";
        this.enableGrid = false;
        this.gridLonResolution = 30;
        this.gridLatResolution = 30;
        this.enableSun = false;
        this.displayTwilight = true;
        this.deltaDays = 0;
        this.deltaHours = 0;
        this.deltaMins = 0;
    }

    gui = new dat.GUI();
    let displayFolder = gui.addFolder('Display');
    displayFolder.add(guiControls, 'enableGrid')
    .onChange(function() {
        requestAnimationFrame(update);
    });

    let lonControl = displayFolder.add(guiControls, 'gridLonResolution', 1, 180, 1).onChange(requestFrame);
    let latControl = displayFolder.add(guiControls, 'gridLatResolution', 1, 180, 1).onChange(requestFrame);
    displayFolder.add(guiControls, 'enableSun').onChange(requestFrame());
    
    let deltaFolder = gui.addFolder('DeltaTime');
    let dayControl = deltaFolder.add(guiControls, 'deltaDays', -185, 185, 1).onChange(requestFrame);
    let hourControl = deltaFolder.add(guiControls, 'deltaHours', -12, 12, 1).onChange(requestFrame);
    let minuteControl = deltaFolder.add(guiControls, 'deltaMins', -30, 30, 1).onChange(requestFrame);

    container = document.getElementById('container');

    window.addEventListener('resize', update, false);


    /*
    document.onmousemove = function(e) 
    {
        uniforms.u_mouse.value.x = e.pageX;
        uniforms.u_mouse.value.y = e.pageY;
    }

    */

    requestFrame();
}


function requestFrame() 
{
    requestAnimationFrame(update);
}

/**
 * Map angle to the interval [0, 2*pi].
 *  
 * @param {*} rad 
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

function drawSun(sunAltitude, rA, decl, JD, JT)
{
    lonlat = sunAltitude.computeSunLonLat(rA, decl, JD, JT);

    contextJs.beginPath();
    contextJs.arc(lonToX(lonlat.lon), latToY(lonlat.lat), 10, 0, Math.PI * 2);
    contextJs.fillStyle = "#ffff00";
    contextJs.fill();

    contextJs.beginPath();
    contextJs.strokeStyle = '#ffff00';
    for (jdDelta = -1.0; jdDelta < 1.0; jdDelta += 0.01)
    {
        lonlat = sunAltitude.computeSunLonLat(rA, decl, JD, JT + jdDelta);

        var x = lonToX(lonlat.lon);
        var y = latToY(lonlat.lat);

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
 * Redraw the map and the contour according to the Sun altitude.
 * 
 */
function update()
{
    if (interval != null)
    {
        clearInterval(interval);
        interval = null;
    }

    console.log("update");

    // Adjust the canvas height according to the body size and the height of the time label.
    var container = document.getElementById("container");
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

    // Compute sidereal time perform modulo to avoid floating point accuracy issues with 32-bit
    // floats in the shader:
    var LST = TimeConversions.computeSiderealTime(0, JD, JT) % 360.0;

    //console.log("Right Ascension : " + Coordinates.rad2Deg(rA) + " deg ");
    //console.log("Declination     : " + Coordinates.rad2Deg(decl) + " deg");
    
    // look up where the vertex data needs to go.
    var positionAttributeLocation = gl.getAttribLocation(program, "a_position");
    var texCoordAttributeLocation = gl.getAttribLocation(program, "a_texCoord");

    // lookup uniforms
    var raLocation = gl.getUniformLocation(program, "u_rA");
    var declLocation = gl.getUniformLocation(program, "u_decl");
    var lstLocation = gl.getUniformLocation(program, "u_LST");
    var resolutionLocation = gl.getUniformLocation(program, "u_resolution");

    gl.uniform1f(raLocation, rA);
    gl.uniform1f(declLocation, decl);
    gl.uniform1f(lstLocation, LST);

    var vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    var positionBuffer = gl.createBuffer();
    gl.enableVertexAttribArray(positionAttributeLocation);
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.vertexAttribPointer(positionAttributeLocation, 2, gl.FLOAT, false, 0, 0);


    ////
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
  
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.bindVertexArray(vao);
    gl.uniform2f(resolutionLocation, gl.canvas.width, gl.canvas.height);

    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        0, 0,
        gl.canvas.width, 0,
        0, gl.canvas.height,
        0, gl.canvas.height,
        gl.canvas.width, 0 ,
        gl.canvas.width, gl.canvas.height,
     ]), gl.STATIC_DRAW);
     gl.drawArrays(gl.TRIANGLES, 0, 6);


    /////////////////////////////////////////////////////

    var dateText = document.getElementById('dateText');
    dateText.innerHTML = "<p>"
    + "Local: " + today.toString() + "<br>"
    + "UTC: " + today.toUTCString() + "<br>"
    + "Julian: " + JT.toString() + "</p>";

    if (guiControls.enableGrid)
    {
        drawGrid();
    }
    if (guiControls.enableSun)
    {
        drawSun(sunAltitude, rA, decl, JD, JT);
    }
    if (interval == null)
    {
        interval = setInterval(function() {requestAnimationFrame(update);}, 100);
    }
}