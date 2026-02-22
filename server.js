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

// 2. FUNCIÓN AUXILIAR PDF (VERSIÓN DOBLE MITAD CON FOTO ✂️📸)
async function generarBytesPDF(data, id) {
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([612, 792]); // Tamaño Carta: Ancho 612, Alto 792
    
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    
    const headerColor = rgb(0.1, 0.3, 0.18); // Verde oscuro institucional
    const gris = rgb(0.4, 0.4, 0.4);

    // --- VARIABLES DEL ALUMNO ---
    const folio = String(id || "N/A");
    const nombreCompleto = `${data.nombre} ${data.apellidoPaterno} ${data.apellidoMaterno}`.toUpperCase();
    const telefono = String(data.telefono || "N/A");

    // --- CARGAR LOGO ---
    let logoImage = null;
    let logoDims = null;
    try {
        const logoUrl = 'https://cbta228.edu.mx/imagenes/logo.png';
        const logoResponse = await fetch(logoUrl);
        const logoImageBytes = await logoResponse.arrayBuffer();
        logoImage = await pdfDoc.embedPng(logoImageBytes);
        logoDims = logoImage.scale(0.4); // Un poco más pequeño para que quepa perfecto en la mitad
    } catch (error) {
        console.error("🔥 No se pudo cargar el logo en el PDF:", error);
    }

    // --- FUNCIÓN PARA DIBUJAR UNA MITAD DE LA HOJA ---
    // Recibe "yTope" que es donde empieza la mitad (792 para arriba, 396 para abajo)
    const dibujarMitad = (yTope) => {
        // 1. Logo
        if (logoImage && logoDims) {
            const logoYPosition = yTope - logoDims.height - 30; // Margen de 30 desde el tope
            page.drawImage(logoImage, {
                x: 40,
                y: logoYPosition,
                width: logoDims.width,
                height: logoDims.height,
            });
        }

        // 2. Títulos
        page.drawText('FICHA DE PRE INSCRIPCIÓN', { x: 190, y: yTope - 50, size: 16, font: boldFont, color: headerColor });
        page.drawText('CICLO ESCOLAR 2026-2027', { x: 215, y: yTope - 70, size: 12, font: boldFont, color: rgb(0.3, 0.3, 0.3) });

        // 3. Recuadro para Foto Tamaño Infantil (Aprox 2.5 x 3 cm -> 71 x 85 puntos)
        const fotoWidth = 75;
        const fotoHeight = 90;
        const fotoX = 612 - 40 - fotoWidth; // Alineado a la derecha
        const fotoY = yTope - 30 - fotoHeight;
        
        page.drawRectangle({
            x: fotoX, y: fotoY, width: fotoWidth, height: fotoHeight,
            borderColor: gris, borderWidth: 1,
        });
        // Textito centrado dentro del recuadro
        page.drawText('FOTO', { x: fotoX + 22, y: fotoY + 40, size: 10, font: boldFont, color: gris });
        page.drawText('Tamaño', { x: fotoX + 18, y: fotoY + 28, size: 8, font: font, color: gris });
        page.drawText('Infantil', { x: fotoX + 19, y: fotoY + 18, size: 8, font: font, color: gris });

        // 4. Datos del Aspirante
        const startY = yTope - 130;
        page.drawText(`No. de Ficha:`, { x: 40, y: startY, size: 12, font: boldFont, color: rgb(0.7, 0.1, 0.1) });
        page.drawText(folio, { x: 120, y: startY, size: 12, font: boldFont });

        page.drawText(`Nombre del Aspirante:`, { x: 40, y: startY - 25, size: 11, font: boldFont });
        page.drawText(nombreCompleto, { x: 175, y: startY - 25, size: 11, font: font });

        page.drawText(`Teléfono:`, { x: 40, y: startY - 50, size: 11, font: boldFont });
        page.drawText(telefono, { x: 100, y: startY - 50, size: 11, font: font });

        // 5. Línea separadora de sección
        page.drawLine({
            start: { x: 40, y: startY - 70 },
            end: { x: 572, y: startY - 70 },
            thickness: 1,
            color: rgb(0.8, 0.8, 0.8),
        });

        // 6. Textos fijos (Requisitos)
        const reqY = startY - 95;
        page.drawText('Documentos que deberás presentar en el plantel junto con esta ficha:', { 
            x: 40, y: reqY, size: 11, font: boldFont 
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
                x: 60, y: reqY - 20 - (index * 15), size: 11, font: font 
            });
        });
    };

    // --- ¡LA MAGIA! MANDAMOS A DIBUJAR AMBAS MITADES ---
    dibujarMitad(792); // Dibuja de la mitad para arriba
    dibujarMitad(396); // Dibuja de la mitad para abajo

    // --- LÍNEA PUNTEADA PARA RECORTAR (EN MEDIO EXACTO: Y=396) ---
    page.drawLine({
        start: { x: 0, y: 396 },
        end: { x: 612, y: 396 },
        thickness: 1,
        color: gris,
        dashArray: [5, 5], // Esto hace que la línea sea punteada (5pts línea, 5pts espacio)
    });

   // Un textito sutil para el recorte (SIN emojis)
    page.drawText('-------------------------------------------------- RECORTAR AQUÍ --------------------------------------------------', { 
        x: 75, y: 393, size: 8, font: font, color: gris 
    });

    return await pdfDoc.save();
}

// 3. RUTAS API (LIMPIAS, SIN CORREO)
// Ruta exclusiva para mantener despierto el servidor (Cronjob)
app.get('/api/ping', (req, res) => {
    res.status(200).send('¡Servidor despierto y listo! 🚀');
});
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