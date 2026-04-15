import fs from "node:fs";
import path from "node:path";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
const c = {
  primary: [15, 76, 92],
  accent: [209, 122, 34],
  text: [31, 41, 51],
  muted: [82, 96, 109],
  soft: [234, 244, 246],
  border: [217, 226, 236],
};

const left = 14;
const right = 14;
const pageWidth = doc.internal.pageSize.getWidth();
const pageHeight = doc.internal.pageSize.getHeight();
const contentWidth = pageWidth - left - right;
const logoPath = path.resolve("D:/plataformaescolar/public/logo_plataforma_digital.png");
const logoBase64 = fs.readFileSync(logoPath).toString("base64");
const logoDataUrl = `data:image/png;base64,${logoBase64}`;

function addHeader(title, subtitle) {
  doc.setFillColor(...c.primary);
  doc.rect(0, 0, pageWidth, 34, "F");
  doc.addImage(logoDataUrl, "PNG", left, 6, 48, 16);
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(title, left, 28);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.text(subtitle, pageWidth - right, 28, { align: "right" });
}

function addFooter() {
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i += 1) {
    doc.setPage(i);
    doc.setDrawColor(...c.border);
    doc.line(left, pageHeight - 12, pageWidth - right, pageHeight - 12);
    doc.setTextColor(...c.muted);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text("Edupleace | Cotizacion referencial en COP", left, pageHeight - 7);
    doc.text(`Pagina ${i} de ${total}`, pageWidth - right, pageHeight - 7, { align: "right" });
  }
}

function section(title, y) {
  doc.setTextColor(...c.primary);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(title, left, y);
}

function body(text, y, options = {}) {
  doc.setTextColor(...c.muted);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(options.size || 9.5);
  doc.text(text, left, y, { maxWidth: contentWidth, ...options });
}

addHeader("Cotizacion Comercial", "Modelo SaaS por estudiante activo");
let y = 44;
section("Resumen del modelo comercial", y);
y += 7;
body("La facturacion principal se realiza por estudiante activo matriculado. Los acudientes van incluidos dentro del valor por estudiante y los usuarios internos se cubren hasta el limite definido en cada plan.", y);
y += 12;
body("\u00BFQu\u00E9 pagar\u00EDas mensual?: cargo fijo mensual + (numero de estudiantes activos x tarifa por estudiante).", y, { size: 10 });
y += 11;
section("Planes comerciales", y);

autoTable(doc, {
  startY: y + 5,
  margin: { left, right, bottom: 18 },
  theme: "grid",
  styles: {
    font: "helvetica",
    fontSize: 8,
    cellPadding: 2.3,
    valign: "top",
    lineColor: c.border,
    textColor: c.text,
    overflow: "linebreak",
  },
  headStyles: {
    fillColor: c.soft,
    textColor: c.primary,
    fontStyle: "bold",
    fontSize: 8,
  },
  columnStyles: {
    0: { cellWidth: 22 },
    1: { cellWidth: 26 },
    2: { cellWidth: 28 },
    3: { cellWidth: 20 },
    4: { cellWidth: 60 },
    5: { cellWidth: 28 },
  },
  head: [["Plan", "Cargo fijo mensual", "Valor por estudiante", "Ideal para", "Usuarios incluidos", "Implementacion"]],
  body: [
    ["Esencial", "COP 350.000", "Desde COP 3.000", "100 a 300", "Hasta 25 profesores y 8 directivos o administrativos. Acudientes incluidos.", "COP 4M a 7M"],
    ["Academico", "COP 500.000", "Desde COP 3.800", "200 a 600", "Hasta 45 profesores y 12 directivos o administrativos. Acudientes incluidos.", "COP 7M a 12M"],
    ["Institucional", "COP 750.000", "Desde COP 4.500", "300 a 900", "Hasta 70 profesores y 20 directivos o administrativos. Acudientes incluidos.", "COP 10M a 18M"],
    ["Integral", "COP 1.100.000", "Desde COP 5.500", "400 a 1.500+", "Hasta 100 profesores y 30 directivos o administrativos. Acudientes incluidos.", "COP 15M a 30M"],
  ],
});

y = doc.lastAutoTable.finalY + 10;
doc.setFillColor(255, 247, 237);
doc.setDrawColor(254, 215, 170);
doc.roundedRect(left, y, contentWidth, 12, 2, 2, "FD");
doc.setTextColor(154, 52, 18);
doc.setFont("helvetica", "bold");
doc.setFontSize(9);
doc.text("Nuestros planes inician desde COP 3.000 por estudiante al mes, mas un cargo fijo mensual segun el alcance funcional y el tamano de la operacion institucional.", left + 3, y + 7, { maxWidth: contentWidth - 6 });

doc.addPage();
addHeader("Detalle de modulos y condiciones", "Edupleace");
y = 44;
section("Modulos por plan", y);

autoTable(doc, {
  startY: y + 5,
  margin: { left, right, bottom: 18 },
  theme: "grid",
  styles: {
    font: "helvetica",
    fontSize: 8.5,
    cellPadding: 2.6,
    valign: "top",
    lineColor: c.border,
    textColor: c.text,
    overflow: "linebreak",
  },
  headStyles: {
    fillColor: c.soft,
    textColor: c.primary,
    fontStyle: "bold",
    fontSize: 8.5,
  },
  columnStyles: {
    0: { cellWidth: 32, fontStyle: "bold" },
    1: { cellWidth: 146 },
  },
  head: [["Plan", "Modulos incluidos"]],
  body: [
    ["Esencial", "Estudiantes, profesores, directivos, usuarios, datos del plantel, mensajes, notificaciones y roles basicos."],
    ["Academico", "Todo el plan Esencial mas tareas, evaluaciones, asistencia, inasistencias, horarios, asignaturas, boletines y certificados."],
    ["Institucional", "Todo el plan Academico mas empleados, permisos, roles avanzados, reportes, circulares, anuncios, portal de acudientes y configuraciones institucionales."],
    ["Integral", "Todo el plan Institucional mas pagos, caja, items de cobro, datos de cobro, servicios complementarios, admisiones CRM y comunicaciones premium."],
  ],
});

y = doc.lastAutoTable.finalY + 9;
section("Servicios y extras", y);
y += 7;
body("Extras mensuales sugeridos:", y, { size: 10 });
y += 6;
body("- Paquete de 10 usuarios administrativos extra: COP 200.000 a 300.000 por mes.", y);
y += 5;
body("- Paquete de 20 docentes extra: COP 250.000 a 400.000 por mes.", y);
y += 5;
body("- Sede adicional: COP 300.000 a 700.000 por mes.", y);
y += 5;
body("- Soporte prioritario: COP 300.000 a 800.000 por mes.", y);
y += 9;
body("Servicios adicionales:", y, { size: 10 });
y += 6;
body("- Migracion de datos: desde COP 1.500.000.", y);
y += 5;
body("- Capacitacion adicional: COP 250.000 a 400.000 por sesion.", y);
y += 5;
body("- Personalizaciones o nuevos desarrollos: cotizacion separada.", y);
y += 5;
body("- SMS, WhatsApp y pasarela de pagos: se cobran segun consumo o tarifa del proveedor.", y);
y += 11;
section("Condiciones comerciales", y);
y += 7;
body("Incluye acceso a la plataforma segun el plan contratado, soporte funcional basico, mantenimiento correctivo, actualizaciones menores y parametrizacion inicial segun el alcance acordado.", y);
y += 12;
body("No incluye comisiones de recaudo, consumo de mensajeria transaccional, desarrollos a la medida no contemplados ni migraciones extraordinarias sin evaluacion previa.", y);

addFooter();
const bytes = doc.output("arraybuffer");
fs.writeFileSync("D:/plataformaescolar/COTIZACION_COMERCIAL_PLANES.pdf", Buffer.from(bytes));



