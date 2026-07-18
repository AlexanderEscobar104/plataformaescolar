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
  highlight: [255, 247, 237],
  highlightBorder: [254, 215, 170],
  highlightText: [154, 52, 18],
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
  doc.rect(0, 0, pageWidth, 38, "F");
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(left, 6, 58, 18, 2, 2, "F");
  doc.addImage(logoDataUrl, "PNG", left + 3, 9, 52, 12);
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);
  doc.text(title, left, 31);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.text(subtitle, pageWidth - right, 31, { align: "right" });
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
  doc.setTextColor(...(options.color || c.muted));
  doc.setFont("helvetica", options.fontStyle || "normal");
  doc.setFontSize(options.size || 9.5);
  doc.text(text, left, y, { maxWidth: contentWidth, ...options });
}

function labelValue(label, value, x, y, w) {
  doc.setDrawColor(...c.border);
  doc.setFillColor(252, 254, 255);
  doc.roundedRect(x, y, w, 22, 2, 2, "FD");
  doc.setTextColor(...c.muted);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text(label, x + 3, y + 6);
  doc.setTextColor(...c.primary);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(value, x + 3, y + 15, { maxWidth: w - 6 });
}

addHeader("Cotizacion Comercial - 1.750 Estudiantes", "Fecha: 03 de junio de 2026 | Vigencia: 30 dias");
let y = 48;
section("Resumen ejecutivo", y);
y += 7;
body("Propuesta referencial para una institucion educativa de aproximadamente 1.750 estudiantes, bajo el plan Integral de Edupleace y modelo SaaS por estudiante activo.", y);
y += 10;
body("El plan Integral aplica porque cubre instituciones desde 400 hasta 1.500 o mas estudiantes y ofrece el alcance funcional mas completo.", y);
y += 14;

const metricGap = 4;
const metricW = (contentWidth - metricGap * 3) / 4;
labelValue("Plan recomendado", "Integral", left, y, metricW);
labelValue("Estudiantes", "1.750", left + metricW + metricGap, y, metricW);
labelValue("Mensualidad", "COP 8.975.000", left + (metricW + metricGap) * 2, y, metricW);
labelValue("Implementacion", "COP 8M a 16M", left + (metricW + metricGap) * 3, y, metricW);
y += 31;

doc.setFillColor(...c.highlight);
doc.setDrawColor(...c.highlightBorder);
doc.roundedRect(left, y, contentWidth, 16, 2, 2, "FD");
doc.setTextColor(...c.highlightText);
doc.setFont("helvetica", "bold");
doc.setFontSize(9);
doc.text("Calculo mensual: COP 1.100.000 de cargo fijo + 1.750 estudiantes x COP 4.500 = COP 8.975.000 / mes.", left + 3, y + 9, { maxWidth: contentWidth - 6 });
y += 27;

section("Detalle comercial", y);
autoTable(doc, {
  startY: y + 5,
  margin: { left, right, bottom: 18 },
  theme: "grid",
  styles: {
    font: "helvetica",
    fontSize: 8.5,
    cellPadding: 2.8,
    valign: "top",
    lineColor: c.border,
    textColor: c.text,
    overflow: "linebreak",
    minCellWidth: 1,
  },
  headStyles: {
    fillColor: c.soft,
    textColor: c.primary,
    fontStyle: "bold",
    fontSize: 8.5,
  },
  columnStyles: {
    0: { cellWidth: 40, fontStyle: "bold" },
    1: { cellWidth: 88 },
    2: { cellWidth: 42, fontStyle: "bold", textColor: c.primary },
  },
  head: [["Concepto", "Alcance", "Valor"]],
  body: [
    ["Cargo fijo mensual", "Acceso base al plan Integral, soporte funcional basico, mantenimiento correctivo y actualizaciones menores.", "COP 1.100.000 / mes"],
    ["Valor por estudiante", "1.750 estudiantes activos estimados. Acudientes incluidos sin cargo adicional.", "COP 4.500 por estudiante / mes"],
    ["Total mensual estimado", "Modelo: cargo fijo mensual + estudiantes activos matriculados.", "COP 8.975.000 / mes"],
    ["Implementacion inicial", "Parametrizacion, configuracion inicial, acompanamiento funcional y puesta en marcha segun alcance acordado.", "COP 8.000.000 a 16.000.000"],
  ],
});

y = doc.lastAutoTable.finalY + 10;
section("Modulos incluidos en el plan Integral", y);
autoTable(doc, {
  startY: y + 5,
  margin: { left, right, bottom: 18 },
  theme: "grid",
  styles: {
    font: "helvetica",
    fontSize: 8.5,
    cellPadding: 2.7,
    valign: "top",
    lineColor: c.border,
    textColor: c.text,
    overflow: "linebreak",
    minCellWidth: 1,
  },
  headStyles: {
    fillColor: c.soft,
    textColor: c.primary,
    fontStyle: "bold",
    fontSize: 8.5,
  },
  columnStyles: {
    0: { cellWidth: 52, fontStyle: "bold" },
    1: { cellWidth: 118 },
  },
  head: [["Modulo / rubro", "Incluye"]],
  body: [
    ["Gestion institucional", "Todo el alcance del plan Institucional para operacion academica, administrativa y de comunicacion."],
    ["Financiero", "Pagos, caja, items de cobro, datos de cobro y servicios complementarios."],
    ["Crecimiento", "Admisiones CRM y comunicaciones premium."],
    ["Comunidad educativa", "Acudientes incluidos dentro del modelo por estudiante, sin cargo adicional."],
  ],
});

doc.addPage();
addHeader("Servicios, extras y condiciones", "Edupleace");
y = 48;
section("Usuarios incluidos", y);
y += 7;
body("El plan Integral cubre hasta 100 profesores y 30 directivos o administrativos. Los acudientes estan incluidos sin costo adicional dentro del modelo por estudiante.", y);
y += 16;

section("Servicios y extras opcionales", y);
autoTable(doc, {
  startY: y + 5,
  margin: { left, right, bottom: 18 },
  theme: "grid",
  styles: {
    font: "helvetica",
    fontSize: 8.5,
    cellPadding: 2.8,
    valign: "top",
    lineColor: c.border,
    textColor: c.text,
    overflow: "linebreak",
    minCellWidth: 1,
  },
  headStyles: {
    fillColor: c.soft,
    textColor: c.primary,
    fontStyle: "bold",
    fontSize: 8.5,
  },
  columnStyles: {
    0: { cellWidth: 64, fontStyle: "bold" },
    1: { cellWidth: 106 },
  },
  head: [["Servicio", "Valor referencial"]],
  body: [
    ["Paquete de 10 usuarios administrativos extra", "COP 200.000 a 300.000 / mes"],
    ["Paquete de 20 docentes extra", "COP 250.000 a 400.000 / mes"],
    ["Sede adicional", "COP 300.000 a 700.000 / mes"],
    ["Soporte prioritario", "COP 300.000 a 800.000 / mes"],
    ["Migracion de datos", "Desde COP 1.500.000"],
    ["Capacitacion adicional", "COP 50.000 a 150.000 por sesion"],
    ["Personalizaciones o nuevos desarrollos", "Cotizacion separada"],
    ["SMS, WhatsApp y pasarela de pagos", "Segun consumo o tarifa del proveedor"],
  ],
});

y = doc.lastAutoTable.finalY + 10;
section("Condiciones comerciales", y);
y += 7;
body("Incluye acceso a la plataforma segun el plan Integral, soporte funcional basico, mantenimiento correctivo, actualizaciones menores y parametrizacion inicial segun el alcance acordado.", y);
y += 13;
body("No incluye comisiones de recaudo de pasarelas de pago, consumo de SMS, WhatsApp o correo transaccional fuera de lo pactado, desarrollos a la medida no contemplados ni migraciones complejas sin evaluacion previa.", y);
y += 17;

section("Datos de ingreso demo", y);
autoTable(doc, {
  startY: y + 5,
  margin: { left, right, bottom: 18 },
  theme: "grid",
  styles: {
    font: "helvetica",
    fontSize: 8.5,
    cellPadding: 2.8,
    valign: "top",
    lineColor: c.border,
    textColor: c.text,
    overflow: "linebreak",
    minCellWidth: 1,
  },
  headStyles: {
    fillColor: c.soft,
    textColor: c.primary,
    fontStyle: "bold",
    fontSize: 8.5,
  },
  columnStyles: {
    0: { cellWidth: 44, fontStyle: "bold" },
    1: { cellWidth: 126 },
  },
  head: [["Acceso", "Datos"]],
  body: [
    ["Portal Edupleace", "Portal: https://app.edupleace.com/login\nIngreso como administrador, estudiante, profesor y otros perfiles.\nUsuario: wilsonhsandoval@gmail.com\nClave: 123456"],
    ["CRM acudiente", "Portal: https://app.edupleace.com/login\nIngreso al CRM de acudiente.\nUsuario: acudientedemo@gmail.com\nClave: 123456"],
  ],
});

y = doc.lastAutoTable.finalY + 10;

section("Datos de contacto", y);
y += 7;
body("Email: edupleace@gmail.com", y, { size: 9 });
y += 5;
body("Celular y WhatsApp: 300 833 6637", y, { size: 9 });
y += 5;
body("Sitio web: https://www.edupleace.com/", y, { size: 9 });
y += 5;
body("Portal: https://app.edupleace.com/login", y, { size: 9 });
y += 9;

doc.setFillColor(...c.highlight);
doc.setDrawColor(...c.highlightBorder);
doc.roundedRect(left, y, contentWidth, 20, 2, 2, "FD");
doc.setTextColor(...c.highlightText);
doc.setFont("helvetica", "normal");
doc.setFontSize(9);
doc.text("Esta cotizacion es referencial y puede ajustarse segun el numero real de estudiantes, usuarios internos, sedes, personalizacion e integraciones requeridas.", left + 3, y + 8, { maxWidth: contentWidth - 6 });
doc.text("El valor mensual final se liquidara con base en los estudiantes activos matriculados durante el periodo de facturacion.", left + 3, y + 15, { maxWidth: contentWidth - 6 });

doc.addPage();
addHeader("Otros planes disponibles", "Valores vigentes de Edupleace");
y = 48;
section("Comparativo de planes", y);
y += 7;
body("Valores tomados de la pagina comercial vigente de Edupleace. La facturacion mensual se calcula como cargo fijo mensual + estudiantes activos por tarifa del plan.", y);

autoTable(doc, {
  startY: y + 13,
  margin: { left, right, bottom: 18 },
  theme: "grid",
  styles: {
    font: "helvetica",
    fontSize: 7.8,
    cellPadding: 2.4,
    valign: "top",
    lineColor: c.border,
    textColor: c.text,
    overflow: "linebreak",
    minCellWidth: 1,
  },
  headStyles: {
    fillColor: c.soft,
    textColor: c.primary,
    fontStyle: "bold",
    fontSize: 7.8,
  },
  columnStyles: {
    0: { cellWidth: 25, fontStyle: "bold" },
    1: { cellWidth: 28 },
    2: { cellWidth: 29 },
    3: { cellWidth: 31 },
    4: { cellWidth: 43 },
    5: { cellWidth: 22, fontStyle: "bold", textColor: c.primary },
  },
  head: [["Plan", "Cargo fijo", "Por estudiante", "Ideal para", "Usuarios", "Implementacion"]],
  body: [
    ["Esencial", "COP 350.000 / mes", "Desde COP 3.000", "100 a 300 estudiantes", "Hasta 25 profesores y 8 admin.", "COP 1M a 2M"],
    ["Academico", "COP 500.000 / mes", "Desde COP 3.600", "200 a 600 estudiantes", "Hasta 45 profesores y 12 admin.", "COP 2M a 6M"],
    ["Institucional", "COP 750.000 / mes", "Desde COP 4.000", "300 a 900 estudiantes", "Hasta 70 profesores y 20 admin.", "COP 6M a 10M"],
    ["Integral", "COP 1.100.000 / mes", "Desde COP 4.500", "400 a 1.500 o mas", "Hasta 100 profesores y 30 admin.", "COP 8M a 16M"],
  ],
});

y = doc.lastAutoTable.finalY + 10;
section("Modulos por plan", y);
autoTable(doc, {
  startY: y + 5,
  margin: { left, right, bottom: 18 },
  theme: "grid",
  styles: {
    font: "helvetica",
    fontSize: 8,
    cellPadding: 2.5,
    valign: "top",
    lineColor: c.border,
    textColor: c.text,
    overflow: "linebreak",
    minCellWidth: 1,
  },
  headStyles: {
    fillColor: c.soft,
    textColor: c.primary,
    fontStyle: "bold",
    fontSize: 8,
  },
  columnStyles: {
    0: { cellWidth: 31, fontStyle: "bold" },
    1: { cellWidth: 139 },
  },
  head: [["Plan", "Modulos"]],
  body: [
    ["Esencial", "Estudiantes, profesores, directivos, usuarios, datos del plantel, mensajes, notificaciones y roles basicos."],
    ["Academico", "Todo el plan Esencial mas tareas, evaluaciones, asistencia, inasistencias, horarios, asignaturas, boletines y certificados."],
    ["Institucional", "Todo el plan Academico mas empleados, permisos, reportes, circulares, anuncios, portal acudientes y configuracion institucional."],
    ["Integral", "Todo el plan Institucional mas pagos, caja, items de cobro, servicios complementarios, admisiones CRM y comunicaciones premium."],
  ],
});

addFooter();
const bytes = doc.output("arraybuffer");
const pdfBuffer = Buffer.from(bytes);
const outputPath = "D:/plataformaescolar/COTIZACION_COMERCIAL_1750_ESTUDIANTES.pdf";
const fallbackPath = "D:/plataformaescolar/COTIZACION_COMERCIAL_1750_ESTUDIANTES_ACTUALIZADA.pdf";
const timestampPath = `D:/plataformaescolar/COTIZACION_COMERCIAL_1750_ESTUDIANTES_ACTUALIZADA_${new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14)}.pdf`;

try {
  fs.writeFileSync(outputPath, pdfBuffer);
} catch (error) {
  if (error.code !== "EBUSY") {
    throw error;
  }
  try {
    fs.writeFileSync(fallbackPath, pdfBuffer);
    console.log(`Archivo principal ocupado. PDF actualizado escrito en: ${fallbackPath}`);
  } catch (fallbackError) {
    if (fallbackError.code !== "EBUSY") {
      throw fallbackError;
    }
    fs.writeFileSync(timestampPath, pdfBuffer);
    console.log(`Archivos principales ocupados. PDF actualizado escrito en: ${timestampPath}`);
  }
}
