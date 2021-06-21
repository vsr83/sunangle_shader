/**
 * Static methods for the computation of the Julian and sidereal time.
 */
var TimeConversions = {};

/**
 * Compute Julian day.
 * 
 * @param {int} year
 *     Year. 
 * @param {int} month
 *     Month of the year (1-12). 
 * @param {int} mday 
 *     Day of the month (1-31).
 * @returns The Julian day.
 */
TimeConversions.computeJulianDay = function(year, month, mday)
{
    A = Math.floor(year / 100);
    B = Math.floor(A / 4.0);
    C = Math.floor(2.0 - A + B);
    E = Math.floor(365.25 * (year + 4716.0));
    F = Math.floor(30.6001 * (month + 1));
    return C + mday + E + F - 1524.5;
}

/**
 * Compute Julian Time from a given Date object.
 * 
 * @param {Date} d 
 *     Date object. 
 * @returns Julian Time.
 */
TimeConversions.computeJulianTime = function(d)
{
    var year = d.getUTCFullYear();
    var month = d.getUTCMonth() + 1;

    if (month < 3)
    {
        year--;
        month+=12;
    }

    var JD = this.computeJulianDay(year, month, d.getUTCDate());

    var JT = JD + d.getUTCHours()/24.0 + d.getUTCMinutes()/(24.0 * 60.0) + d.getUTCSeconds()/(24.0 * 60.0 * 60.0)
            + d.getUTCMilliseconds()/(24.0 * 60.0 * 60.0 * 1000.0);
    
    return {JT : JT, JD : JD};
}

/**
 * Compute sidereal time.
 * 
 * @param {*} longitude 
 *     Longitude of the observer (in degrees).
 * @param {*} JD 
 *     Julian day.
 * @param {*} JT 
 *     Julian time.
 * @returns Sidereal time (in degrees).
 */
TimeConversions.computeSiderealTime = function(longitude, JD, JT)
{
    JDref = Math.ceil(this.computeJulianDay(2000, 1, 1));
    tfac = (JD - JDref) / 36525.0

    LST = 100.46061837 + 36000.770053608 * tfac + 0.000387933 * tfac * tfac 
        + 1.00273790935 * (JT - JD) * 360.0 + longitude;
    
    return LST;
}

