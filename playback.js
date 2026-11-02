(function attachPlayback(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ORGANO_PLAYBACK = api;
})(typeof window === "undefined" ? globalThis : window, function playbackFactory() {
  function createPlaybackController({
    length,
    initialIndex = 0,
    delayMs = 4500,
    onIndex,
    onPlaying,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
  }) {
    if (!Number.isInteger(length) || length < 1) throw new RangeError("length must be a positive integer");

    let index = Math.max(0, Math.min(initialIndex, length - 1));
    let playing = false;
    let timer = null;

    function cancelTimer() {
      if (timer === null) return;
      clearTimer(timer);
      timer = null;
    }

    function pause() {
      cancelTimer();
      if (!playing) return;
      playing = false;
      onPlaying(false);
    }

    function scheduleNext() {
      cancelTimer();
      if (!playing) return;
      if (index >= length - 1) {
        pause();
        return;
      }
      timer = setTimer(() => {
        timer = null;
        index += 1;
        onIndex(index, true);
        if (index >= length - 1) pause();
        else scheduleNext();
      }, delayMs);
    }

    function play() {
      if (playing) return;
      if (index >= length - 1) {
        index = 0;
        onIndex(index, true);
      }
      playing = true;
      onPlaying(true);
      scheduleNext();
    }

    function select(nextIndex) {
      pause();
      index = Math.max(0, Math.min(nextIndex, length - 1));
      onIndex(index, true);
    }

    return {
      get index() { return index; },
      get isPlaying() { return playing; },
      play,
      pause,
      toggle() { playing ? pause() : play(); },
      select,
      next() { select(index + 1); },
      previous() { select(index - 1); },
    };
  }

  return {createPlaybackController};
});

