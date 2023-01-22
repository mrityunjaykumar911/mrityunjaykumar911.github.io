
TEX_INPUT_FILENAME_FULL_PATH="main.tex"
#GUID="`uuidgen`"
UPLOAD_FOLDER="camera-ready"
GUID="319c529-9da6-4239-87a1-5b80ae2035e7"
GUID_DIRNAME="DIR_${GUID}"
GEN_DATE=$(date '+%Y-%m-%d-%H:%M:%S')
CV_NAME="mrityunjay-kumar-cv-${GUID}"
FINAL_CV_NAME="mrityunjay-kumar-cv-${GEN_DATE}.pdf"
PARENTDIR="`pwd`"
PDF_OP_PARENT_DIR="$PARENTDIR/DIR_GeneratedPdf"
PDF_OP_DIR="$PDF_OP_PARENT_DIR/pdf/${GUID_DIRNAME}/${CV_NAME}"
HTML_OP_DIR="$PDF_OP_PARENT_DIR/html/${GUID_DIRNAME}/${CV_NAME}"
generate_log="${PDF_OP_DIR}/1.log"
DELETE_TEMP=1
CLEANUP_CAMERA=1


function CreateDirectory ()
{
    inputDirName="$1"
    if [ ! -d $inputDirName ]; then
        # echo "input folder ${inputDirName} does not exist"
        mkdir -p $inputDirName
    fi
}

function GenerateTempDirectory ()
{
    CreateDirectory ${PDF_OP_DIR}
}

function GeneratePdf ()
{
    pdflatex -jobname "${CV_NAME}" -output-directory=${PDF_OP_DIR} ${TEX_INPUT_FILENAME_FULL_PATH}
    RenamePdf
    UploadPdf
    GeneratePdf2Html
    CleanUp
}

function RenamePdf ()
{
    echo "rename pdf to ${PDF_OP_DIR}/${FINAL_CV_NAME}.pdf"
    mv "${PDF_OP_DIR}/${CV_NAME}.pdf" "${PDF_OP_DIR}/${FINAL_CV_NAME}"
}

function CleanUp ()
{
    if [ $DELETE_TEMP -eq 1 ]; then
        echo "cleanup"
        rm -rf "${PDF_OP_PARENT_DIR}"
    fi
}

function CleanUpCamera ()
{
    if [ $CLEANUP_CAMERA -eq 1 ]; then
        echo "cleanup camera"
        rm -rf "${UPLOAD_FOLDER}"
    fi
}

function UploadPdf ()
{
    echo "upload"
    
    CreateDirectory $UPLOAD_FOLDER
    mv "${PDF_OP_DIR}/${FINAL_CV_NAME}" $UPLOAD_FOLDER
}

function GeneratePdf2Html ()
{
    echo "pdf2html here ${UPLOAD_FOLDER}/${FINAL_CV_NAME}"
    pdf2htmlEX --dest-dir "${UPLOAD_FOLDER}" "${UPLOAD_FOLDER}/${FINAL_CV_NAME}"
}

function Generate()
{
    echo "Generate PDF" && GeneratePdf
}


function Init ()
{
    echo "Clean up camera ready" && CleanUpCamera
    echo "Generate Temp Dirs" && GenerateTempDirectory
}

function Execute ()
{
    echo "-----------------------------------------------------------"
    echo "Init" && Init
    echo "Generate PDF" && Generate > ${generate_log}
    echo "-----------------------------------------------------------"
}

Execute