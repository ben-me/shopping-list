/**
 * One async job at a time, with a single queued rerun.
 *
 * A caller arriving while a run is in flight does not start a second one: it
 * asks for exactly one more run and awaits the flight already in flight, so a
 * caller that awaits observes the state after its own request has been served.
 * Any number of callers queueing behind a run still buy only that one rerun.
 *
 * `widen` merges a newly requested argument into the one already queued for the
 * rerun. That is how a caller asks for more than the running job can give (a
 * wider Sync scope) without the flight knowing what a scope is.
 *
 * All the state lives inside the returned handle: two flights never see each
 * other, and nothing outside is touched.
 */
interface SingleFlight<Arg> {
  run(arg: Arg, job: (arg: Arg) => Promise<void>): Promise<void>;
}

export function createSingleFlight<Arg>(
  widen: (queued: Arg, requested: Arg) => Arg,
): SingleFlight<Arg> {
  let inFlight: Promise<void> | null = null;
  let queued: { arg: Arg } | null = null;

  /** Ask for a rerun, widening one that is already waiting. */
  const queueRerun = (arg: Arg): void => {
    queued = queued ? { arg: widen(queued.arg, arg) } : { arg };
  };

  /** The rerun waiting to happen, if any; asking takes it off the queue. */
  const takeRerun = (): { arg: Arg } | null => {
    const rerun = queued;
    queued = null;
    return rerun;
  };

  const fly = async (job: (arg: Arg) => Promise<void>, first: Arg): Promise<void> => {
    let arg = first;
    for (;;) {
      await job(arg);
      const rerun = takeRerun();
      if (!rerun) {
        return;
      }
      arg = widen(arg, rerun.arg);
    }
  };

  return {
    run(arg, job) {
      if (inFlight) {
        queueRerun(arg);
        return inFlight;
      }
      // A run starts with nothing queued: a rerun a failed run never got to
      // serve is not owed to the next one.
      queued = null;
      inFlight = fly(job, arg).finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
  };
}
