require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2');
const nodemailer = require('nodemailer');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const path = require('path');

const app = express();
// app.use(cors());
// Configuración de seguridad para aceptar peticiones solo de tu web
app.use(cors({
    origin: [
        'https://cbta228.edu.mx', 
        'http://cbta228.edu.mx',
        'http://localhost:5173' // Para pruebas locales
    ],
    methods: ['GET', 'POST'],
    credentials: true
}));
app.use(express.json());

// 1. CONEXIÓN DB
const db = mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'preinscripcion_db'
});

db.connect(err => {
    if (err) return console.error('Error DB:', err);
    console.log('Conectado a MySQL.');
});

// 2. TRANSPORTE CORREO
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// FUNCIÓN AUXILIAR PDF (Para no repetir código)
async function generarBytesPDF(data, id) {
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    
    // Colores
    const headerColor = rgb(0, 0.53, 0.71); // Azul bonito
    const black = rgb(0, 0, 0);

    // Configuración inicial
    let y = 750; // Posición vertical inicial (se irá restando para bajar)
    const xLabel = 50;
    const xValue = 200;
    const step = 20; // Espacio entre líneas

    // Título Principal
    page.drawText('FICHA DE PRE-REGISTRO CBTA 228', { x: 50, y, font: boldFont, size: 18, color: headerColor });
    page.drawText(`Folio No: ${id}`, { x: 400, y, font: boldFont, size: 14, color: rgb(1, 0, 0) });
    y -= 40;

    // Función auxiliar para dibujar líneas
    const drawField = (label, value) => {
        page.drawText(label, { x: xLabel, y, font: boldFont, size: 10, color: black });
        // Aseguramos que el valor sea texto y manejamos vacíos
        const textValue = value ? String(value) : 'N/A';
        page.drawText(textValue, { x: xValue, y, font, size: 10, color: black });
        y -= step;
    };

    const drawSectionHeader = (title) => {
        y -= 10;
        page.drawText(title, { x: xLabel, y, font: boldFont, size: 12, color: headerColor });
        y -= 25;
    };

    // --- SECCIÓN 1: DATOS DEL ASPIRANTE ---
    drawSectionHeader('DATOS PERSONALES');
    drawField('Nombre Completo:', `${data.nombre} ${data.apellidoPaterno} ${data.apellidoMaterno}`);
    drawField('CURP:', data.curp);
    drawField('Fecha de Nacimiento:', new Date(data.fechaNacimiento).toLocaleDateString('es-MX'));
    drawField('Género:', data.genero);
    drawField('Carrera de Interés:', data.carrera);
    drawField('Correo Electrónico:', data.correo);
    drawField('Teléfono Móvil:', data.telefono);

    // --- SECCIÓN 2: DIRECCIÓN ---
    drawSectionHeader('DOMICILIO');
    drawField('Calle y Número:', `${data.calle} #${data.numeroExterior} ${data.numeroInterior ? 'Int. ' + data.numeroInterior : ''}`);
    drawField('Colonia:', data.colonia);
    drawField('Municipio / Estado:', `${data.municipio}, ${data.estado}`);
    drawField('Código Postal:', data.codigoPostal);

    // --- SECCIÓN 3: PROCEDENCIA ---
    drawSectionHeader('DATOS ACADÉMICOS (SECUNDARIA)');
    drawField('Nombre Secundaria:', data.nombreSecundaria);
    drawField('Tipo / Sostenimiento:', `${data.tipoSecundaria} - ${data.sostenimiento}`);
    drawField('Localidad Secundaria:', data.localidadSecundaria);
    drawField('Promedio General:', String(data.promedio));

    // --- SECCIÓN 4: TUTOR ---
    drawSectionHeader('DATOS DEL TUTOR');
    drawField('Nombre del Tutor:', data.nombreTutor);
    drawField('Ocupación:', data.ocupacionTutor);
    drawField('Teléfono del Tutor:', data.telefonoTutor);

    // Pie de página
    page.drawText('Este documento es un comprobante de pre-registro. Presentarlo en servicios escolares.', {
        x: 50,
        y: 50,
        size: 8,
        font,
        color: rgb(0.5, 0.5, 0.5)
    });

    return await pdfDoc.save();
}

// 3. RUTAS API
app.post('/api/preinscripcion', (req, res) => {
    const formData = req.body;

    // Validación duplicados
    db.query('SELECT id FROM aspirantes WHERE correo = ? OR curp = ?', [formData.correo, formData.curp], (err, results) => {
        if (results && results.length > 0) return res.status(409).json({ message: 'Correo o CURP ya registrados.' });

        const sql = `INSERT INTO aspirantes (correo, curp, nombre, apellidoPaterno, apellidoMaterno, genero, fechaNacimiento, carrera, calle, numeroExterior, numeroInterior, colonia, municipio, codigoPostal, estado, telefono, promedio, tipoSecundaria, sostenimiento, localidadSecundaria, nombreSecundaria, nombreTutor, ocupacionTutor, telefonoTutor) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;
        const values = [formData.correo, formData.curp, formData.nombre, formData.apellidoPaterno, formData.apellidoMaterno, formData.genero, formData.fechaNacimiento, formData.carrera, formData.calle, formData.numeroExterior, formData.numeroInterior, formData.colonia, formData.municipio, formData.codigoPostal, formData.estado, formData.telefono, formData.promedio, formData.tipoSecundaria, formData.sostenimiento, formData.localidadSecundaria, formData.nombreSecundaria, formData.nombreTutor, formData.ocupacionTutor, formData.telefonoTutor];

        db.query(sql, values, async (err, result) => {
            if (err) return res.status(500).json({ message: 'Error al registrar.' });
            
            const fichaId = result.insertId;
            try {
                const pdfBytes = await generarBytesPDF(formData, fichaId);
                await transporter.sendMail({
                    from: process.env.EMAIL_USER,
                    to: formData.correo,
                    subject: `Ficha de Registro #${fichaId}`,
                    html: `<p>Hola ${formData.nombre}, adjuntamos tu ficha.</p>`,
                    attachments: [{ filename: `ficha_${fichaId}.pdf`, content: Buffer.from(pdfBytes) }]
                });
                res.status(200).json({ message: 'Éxito', fichaId });
            } catch (e) {
                res.status(200).json({ message: 'Registrado, pero el correo falló.', fichaId });
            }
        });
    });
});

app.get('/api/generar-ficha/:fichaId', (req, res) => {
    const { fichaId } = req.params;
    db.query('SELECT * FROM aspirantes WHERE id = ?', [fichaId], async (err, results) => {
        if (err || results.length === 0) return res.status(404).send('No encontrado');
        const pdfBytes = await generarBytesPDF(results[0], fichaId);
        res.setHeader('Content-Type', 'application/pdf');
        res.send(Buffer.from(pdfBytes));
    });
});

// --- EL CAMBIO CLAVE PARA EL ERROR QUE TE SALIÓ ---
// En lugar de '*', usamos '(.*)' que es el formato que aceptan las versiones nuevas
// app.use(express.static(path.join(__dirname, 'dist')));

// app.get('*', (req, res) => {
//     res.sendFile(path.join(__dirname, 'dist', 'index.html'));
// });

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Servidor activo en puerto ${PORT}`);
});