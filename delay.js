// API is a simple delay promise
module.exports = time => new Promise(res => setTimeout(() => res(), time));
