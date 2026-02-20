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

// 2. TRANSPORTE CORREO (CORREGIDO Y OPTIMIZADO)
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
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
    
    const headerColor = rgb(0, 0.53, 0.71); 
    const black = rgb(0, 0, 0);

    let y = 750; 
    const xLabel = 50;
    const xValue = 200;
    const step = 20; 

    page.drawText('FICHA DE PRE-REGISTRO CBTA 228', { x: 50, y, font: boldFont, size: 18, color: headerColor });
    page.drawText(`Folio No: ${id}`, { x: 400, y, font: boldFont, size: 14, color: rgb(1, 0, 0) });
    y -= 40;

    const drawField = (label, value) => {
        page.drawText(label, { x: xLabel, y, font: boldFont, size: 10, color: black });
        const textValue = value ? String(value) : 'N/A';
        page.drawText(textValue, { x: xValue, y, font, size: 10, color: black });
        y -= step;
    };

    const drawSectionHeader = (title) => {
        y -= 10;
        page.drawText(title, { x: xLabel, y, font: boldFont, size: 12, color: headerColor });
        y -= 25;
    };

    drawSectionHeader('DATOS PERSONALES');
    drawField('Nombre Completo:', `${data.nombre} ${data.apellidoPaterno} ${data.apellidoMaterno}`);
    drawField('CURP:', data.curp);
    drawField('Fecha de Nacimiento:', new Date(data.fechaNacimiento).toLocaleDateString('es-MX'));
    drawField('Género:', data.genero);
    drawField('Carrera de Interés:', data.carrera);
    drawField('Correo Electrónico:', data.correo);
    drawField('Teléfono Móvil:', data.telefono);

    drawSectionHeader('DOMICILIO');
    drawField('Calle y Número:', `${data.calle} #${data.numeroExterior} ${data.numeroInterior ? 'Int. ' + data.numeroInterior : ''}`);
    drawField('Colonia:', data.colonia);
    drawField('Municipio / Estado:', `${data.municipio}, ${data.estado}`);
    drawField('Código Postal:', data.codigoPostal);

    drawSectionHeader('DATOS ACADÉMICOS (SECUNDARIA)');
    drawField('Nombre Secundaria:', data.nombreSecundaria);
    drawField('Tipo / Sostenimiento:', `${data.tipoSecundaria} - ${data.sostenimiento}`);
    drawField('Localidad Secundaria:', data.localidadSecundaria);
    drawField('Promedio General:', String(data.promedio));

    drawSectionHeader('DATOS DEL TUTOR');
    drawField('Nombre del Tutor:', data.nombreTutor);
    drawField('Ocupación:', data.ocupacionTutor);
    drawField('Teléfono del Tutor:', data.telefonoTutor);

    page.drawText('Este documento es un comprobante de pre-registro. Presentarlo en servicios escolares.', {
        x: 50, y: 50, size: 8, font, color: rgb(0.5, 0.5, 0.5)
    });

    return await pdfDoc.save();
}

// 3. RUTAS API (CON LINTERNAS DE ERRORES)
app.post('/api/preinscripcion', (req, res) => {
    const formData = req.body;

    db.query('SELECT id FROM aspirantes WHERE correo = ? OR curp = ?', [formData.correo, formData.curp], (err, results) => {
        if (err) {
            console.error("🔥 ERROR EN SELECT DB:", err);
            return res.status(500).json({ message: 'Error de conexión.' });
        }
        if (results && results.length > 0) return res.status(409).json({ message: 'Correo o CURP ya registrados.' });

        const sql = `INSERT INTO aspirantes (correo, curp, nombre, apellidoPaterno, apellidoMaterno, genero, fechaNacimiento, carrera, calle, numeroExterior, numeroInterior, colonia, municipio, codigoPostal, estado, telefono, promedio, tipoSecundaria, sostenimiento, localidadSecundaria, nombreSecundaria, nombreTutor, ocupacionTutor, telefonoTutor) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;
        const values = [formData.correo, formData.curp, formData.nombre, formData.apellidoPaterno, formData.apellidoMaterno, formData.genero, formData.fechaNacimiento, formData.carrera, formData.calle, formData.numeroExterior, formData.numeroInterior, formData.colonia, formData.municipio, formData.codigoPostal, formData.estado, formData.telefono, formData.promedio, formData.tipoSecundaria, formData.sostenimiento, formData.localidadSecundaria, formData.nombreSecundaria, formData.nombreTutor, formData.ocupacionTutor, formData.telefonoTutor];

        db.query(sql, values, async (err, result) => {
            if (err) {
                console.error("🔥 ERROR AL INSERTAR EN DB:", err); // ¡Aquí estaba el error oculto!
                return res.status(500).json({ message: 'Error al registrar.' });
            }
            
            const fichaId = result.insertId;
            try {
                const pdfBytes = await generarBytesPDF(formData, fichaId);
                await transporter.sendMail({
                    from: process.env.EMAIL_USER,
                    to: formData.correo,
                    subject: `Ficha de Registro #${fichaId}`,
                    html: `<p>Hola ${formData.nombre}, adjuntamos tu ficha de pre-registro.</p>`,
                    attachments: [{ filename: `ficha_${fichaId}.pdf`, content: Buffer.from(pdfBytes) }]
                });
                res.status(200).json({ message: 'Éxito', fichaId });
            } catch (e) {
                console.error("🔥 ERROR EN CORREO O PDF:", e);
                res.status(200).json({ message: 'Registrado, pero el correo falló.', fichaId });
            }
        });
    });
});

app.get('/api/generar-ficha/:fichaId', (req, res) => {
    const { fichaId } = req.params;
    db.query('SELECT * FROM aspirantes WHERE id = ?', [fichaId], async (err, results) => {
        if (err) {
            console.error("🔥 ERROR DB AL BUSCAR PDF:", err);
            return res.status(500).send('Error interno del servidor');
        }
        if (results.length === 0) {
            console.error("🔥 FICHA NO ENCONTRADA, ID:", fichaId);
            return res.status(404).send('No encontrado');
        }
        try {
            const pdfBytes = await generarBytesPDF(results[0], fichaId);
            res.setHeader('Content-Type', 'application/pdf');
            res.send(Buffer.from(pdfBytes));
        } catch (e) {
            console.error("🔥 ERROR GENERANDO ARCHIVO PDF:", e);
            res.status(500).send('Error generando PDF');
        }
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