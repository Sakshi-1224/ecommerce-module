import autocannon from "autocannon";

const url = "http://localhost:5007/api/products";   // your API url
const duration = 30;                  // duration in seconds

const instance = autocannon(
  {
    url,
    duration
  },
  (err, result) => {
    if (err) {
      console.error("Error:", err);
    } else {
      console.log("Number of requests:", result.requests.total);
      console.log("Duration (seconds):", result.duration);
      console.log("Requests per second:", result.requests.average);
      console.log("Latency average (ms):", result.latency.average);
      console.log("Errors:", result.errors);
    }
  }
);

// Shows live progress in terminal
autocannon.track(instance);
