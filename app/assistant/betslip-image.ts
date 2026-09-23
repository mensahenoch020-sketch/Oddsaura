export type BetslipImageSelection = {
  match: string;
  market: string;
  selection: string;
  odds: number | null;
};

export type BetslipImageInput = {
  provider: string;
  code: string;
  totalOdds: number | null;
  selections: BetslipImageSelection[];
};

const safeName = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function wrap(context: CanvasRenderingContext2D, value: string, maxWidth: number) {
  const words = value.trim().split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (context.measureText(candidate).width <= maxWidth || !line) line = candidate;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines;
}

export async function createBetslipPng(input: BetslipImageInput) {
  const width = 1080;
  const rowHeights = input.selections.map((selection) => Math.max(156, 82 + Math.ceil(selection.match.length / 31) * 34));
  const height = 500 + rowHeights.reduce((sum, value) => sum + value, 0);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot create a betslip image.");

  context.fillStyle = "#0b1730";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#ff4d2e";
  context.fillRect(0, 0, 22, height);
  context.fillRect(0, 0, width, 18);

  context.fillStyle = "#ffffff";
  context.font = "800 66px Arial";
  context.fillText("OddsAura", 80, 112);
  context.fillStyle = "#b8c4da";
  context.font = "700 24px Arial";
  context.fillText(`${input.provider.toUpperCase()} · ${new Date().toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}`, 82, 158);
  context.fillStyle = "#ff4d2e";
  context.fillRect(82, 190, 150, 8);

  const cardX = 62, cardY = 240, cardWidth = width - 124;
  context.fillStyle = "#ffffff";
  context.beginPath();
  context.roundRect(cardX, cardY, cardWidth, height - 320, 34);
  context.fill();

  let y = cardY + 64;
  input.selections.forEach((selection, index) => {
    context.fillStyle = "#0b1730";
    context.font = "800 30px Arial";
    const matchLines = wrap(context, selection.match, 690);
    matchLines.slice(0, 2).forEach((line, lineIndex) => context.fillText(line, 112, y + lineIndex * 36));
    const marketY = y + matchLines.slice(0, 2).length * 36 + 10;
    context.fillStyle = "#667085";
    context.font = "500 24px Arial";
    const pickLines = wrap(context, `${selection.market}: ${selection.selection}`, 690);
    pickLines.slice(0, 2).forEach((line, lineIndex) => context.fillText(line, 112, marketY + lineIndex * 31));
    context.fillStyle = "#0b1730";
    context.beginPath();
    context.roundRect(820, y - 30, 120, 54, 27);
    context.fill();
    context.fillStyle = "#ffffff";
    context.font = "700 26px Arial";
    context.textAlign = "center";
    context.fillText(selection.odds?.toFixed(2) ?? "—", 880, y + 7);
    context.textAlign = "left";
    y += rowHeights[index]!;
    if (index < input.selections.length - 1) {
      context.fillStyle = "#e4e7ec";
      context.fillRect(102, y - 44, 836, 2);
    }
  });

  context.fillStyle = "#f2f4f7";
  context.beginPath();
  context.roundRect(102, height - 210, 836, 92, 24);
  context.fill();
  context.fillStyle = "#0b1730";
  context.font = "800 25px Arial";
  context.fillText("COMBINED ODDS", 138, height - 154);
  context.textAlign = "right";
  context.font = "800 38px Arial";
  context.fillText(input.totalOdds?.toFixed(2) ?? "Check bookmaker", 900, height - 150);
  context.textAlign = "left";
  context.fillStyle = "#b8c4da";
  context.font = "600 21px Arial";
  context.fillText(`CODE  ${input.code}`, 82, height - 52);
  context.textAlign = "right";
  context.fillText("Check the final bookmaker slip · 18+", width - 72, height - 52);

  return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("The betslip image could not be created.")), "image/png", .94));
}

export async function saveBetslipImage(input: BetslipImageInput) {
  const blob = await createBetslipPng(input);
  const filename = `oddsaura-${safeName(input.provider)}-${safeName(input.code)}.png`;
  const file = new File([blob], filename, { type: "image/png" });
  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: `${input.provider} betslip ${input.code}` });
    return;
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
