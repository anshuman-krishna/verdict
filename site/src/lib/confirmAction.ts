export interface ArmedConfirmationOptions {
  label: string;
  armedLabel: string;
  windowMs: number;
  setLabel: (label: string) => void;
  setTimeout: (handler: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

export interface ArmedConfirmation {
  press: () => boolean;
  isArmed: () => boolean;
}

// first press arms, second press confirms
export function armedConfirmation(options: ArmedConfirmationOptions): ArmedConfirmation {
  let timer: unknown = null;

  const disarm = () => {
    if (timer !== null) {
      options.clearTimeout(timer);
      timer = null;
    }
    options.setLabel(options.label);
  };

  return {
    press() {
      if (timer !== null) {
        disarm();
        return true;
      }
      options.setLabel(options.armedLabel);
      timer = options.setTimeout(disarm, options.windowMs);
      return false;
    },
    isArmed: () => timer !== null,
  };
}
