// The adhan. Not the desktop's event-sound player: that one is silent when "event sounds" are
// off and libcanberra can't decode MP3.
// pw-play (PipeWire) or paplay (PulseAudio) play WAV/OGG/MP3 through libsndfile, in their own
// process, so a long adhan costs the shell nothing and can be stopped.
const PLAYERS = ['pw-play', 'paplay'];

let current = null;

// Plays the audio file at `path`, replacing any sound still playing.
function playSound(gi, file) {
    const { Gio } = gi;
    stopSound();
    if (!Gio.File.new_for_path(file).query_exists(null)) {
        console.warn(`ponitch: sound file not found: ${file}`);
        return;
    }
    for (const player of PLAYERS) {
        try {
            // argv, no shell: the path is passed as one argument whatever it contains.
            const proc = Gio.Subprocess.new([player, file], Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE);
            current = proc;
            proc.wait_async(null, () => {
                if (current === proc)
                    current = null;
            });
            return;
        } catch (e) {
            // Player not installed: try the next one.
        }
    }
    console.warn('ponitch: no sound player (pw-play or paplay) found');
}

function stopSound() {
    if (current)
        current.force_exit();
    current = null;
}

module.exports = { playSound, stopSound };
