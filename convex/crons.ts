import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Close rooms nobody has used for 2 hours and delete rooms closed for an hour.
crons.interval("clean up idle rooms", { minutes: 15 }, internal.rooms.cleanup, {});

export default crons;
