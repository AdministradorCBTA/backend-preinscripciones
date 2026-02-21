require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

const app = express();

// Configuración de seguridad
app.use(cors({
    origin: [
        'https://cbta228.edu.mx', 
        'http://cbta228.edu.mx',
        'http://localhost:5173'
    ],
    methods: ['GET', 'POST'],
    credentials: true
}));
app.use(express.json());

// 1. CONEXIÓN DB (CON POOL DE CONEXIONES)
const db = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'preinscripcion_db',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

db.getConnection((err, connection) => {
    if (err) {
        console.error('🔥 Error al conectar al Pool DB:', err);
    } else {
        console.log('✅ Conectado exitosamente al Pool de MySQL.');
        connection.release();
    }
});

// 2. FUNCIÓN AUXILIAR PDF (¡VERSIÓN ULTRA RÁPIDA Y OPTIMIZADA! ⚡)
async function generarBytesPDF(data, id) {
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([612, 792]); // Tamaño Carta
    
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    
    const headerColor = rgb(0.1, 0.3, 0.18); // Verde oscuro institucional

    // --- VARIABLES DEL ALUMNO ---
    const folio = String(id || "N/A");
    const nombreCompleto = `${data.nombre} ${data.apellidoPaterno} ${data.apellidoMaterno}`.toUpperCase();
    const telefono = String(data.telefono || "N/A");

    // --- LOGO ---
    try {
        const logoUrl = 'https://cbta228.edu.mx/imagenes/logo-cbta-grande.png';
        const logoResponse = await fetch(logoUrl);
        const logoImageBytes = await logoResponse.arrayBuffer();
        const logoImage = await pdfDoc.embedPng(logoImageBytes);
        
        const logoDims = logoImage.scale(0.5); 
        page.drawImage(logoImage, {
            x: 50,
            y: 792 - 100, 
            width: logoDims.width,
            height: logoDims.height,
        });
    } catch (error) {
        console.error("🔥 No se pudo cargar el logo en el PDF:", error);
    }

    // --- ENCABEZADOS ---
    page.drawText('FICHA DE PRE INSCRIPCIÓN', { 
        x: 200, y: 730, size: 20, font: boldFont, color: headerColor 
    });
    page.drawText('CICLO ESCOLAR 2026-2027', { 
        x: 230, y: 700, size: 14, font: boldFont, color: rgb(0.3, 0.3, 0.3) 
    });

    // --- DATOS DEL ASPIRANTE ---
    const startY = 620;
    page.drawText(`No. de Ficha:`, { x: 50, y: startY, size: 14, font: boldFont, color: rgb(0.7, 0.1, 0.1) });
    page.drawText(folio, { x: 145, y: startY, size: 14, font: boldFont });

    page.drawText(`Nombre del Aspirante:`, { x: 50, y: startY - 30, size: 12, font: boldFont });
    page.drawText(nombreCompleto, { x: 195, y: startY - 30, size: 12, font: font });

    page.drawText(`Teléfono:`, { x: 50, y: startY - 60, size: 12, font: boldFont });
    page.drawText(telefono, { x: 115, y: startY - 60, size: 12, font: font });

    // --- LÍNEA SEPARADORA ---
    page.drawLine({
        start: { x: 50, y: startY - 90 },
        end: { x: 562, y: startY - 90 },
        thickness: 1,
        color: rgb(0.8, 0.8, 0.8),
    });

    // --- REQUISITOS (TEXTO FIJO) ---
    const reqY = startY - 130;
    page.drawText('Documentos que deberás presentar en el plantel junto con esta ficha:', { 
        x: 50, y: reqY, size: 12, font: boldFont 
    });
    
    const requisitos = [
        "- Constancia con promedio",
        "- CURP Verificada",
        "- Copia de Acta de Nacimiento",
        "- 2 fotos",
        "- Pago"
    ];

    requisitos.forEach((req, index) => {
        page.drawText(req, { 
            x: 70, y: reqY - 25 - (index * 20), size: 12, font: font 
        });
    });

    return await pdfDoc.save();
}

// 3. RUTAS API (LIMPIAS, SIN CORREO)
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
                console.error("🔥 ERROR AL INSERTAR EN DB:", err);
                return res.status(500).json({ message: 'Error al registrar.' });
            }
            
            const fichaId = result.insertId;
            res.status(200).json({ message: 'Éxito', fichaId });
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

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Servidor activo en puerto ${PORT}`);
});