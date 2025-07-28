import os
import json
import markdown
import re
from flask import Flask, render_template, request, redirect, url_for
from dotenv import load_dotenv
from review_workflow import create_workflow
import docx
import PyPDF2

# Load environment variables
load_dotenv()

app = Flask(__name__)
PERSONAS_FILE = 'personas.json'

def load_personas():
    """Loads personas from the JSON file."""
    if not os.path.exists(PERSONAS_FILE):
        # Create a default personas file if it doesn't exist
        default_personas = {
            "strict": {"name": "Strict Reviewer", "prompt": "You are a strict reviewer..."},
            "forgiving": {"name": "Forgiving Reviewer", "prompt": "You are a forgiving reviewer..."}
        }
        with open(PERSONAS_FILE, 'w') as f:
            json.dump(default_personas, f, indent=4)
        return default_personas
    with open(PERSONAS_FILE, 'r') as f:
        return json.load(f)

def save_personas(personas_data):
    """Saves personas to the JSON file."""
    with open(PERSONAS_FILE, 'w') as f:
        json.dump(personas_data, f, indent=4)

def extract_text_from_file(file):
    """Extracts text from an uploaded file based on its type."""
    filename = file.filename
    print(f"--- Attempting to extract text from: {filename} ---")
    text = ""
    try:
        if filename.endswith('.txt') or filename.endswith('.md'):
            print("--- Handling as a text file ---")
            text = file.read().decode('utf-8')
        elif filename.endswith('.docx'):
            print("--- Handling as a .docx file ---")
            doc = docx.Document(file)
            text = "\n".join([para.text for para in doc.paragraphs])
        elif filename.endswith('.pdf'):
            print("--- Handling as a .pdf file ---")
            pdf_reader = PyPDF2.PdfReader(file)
            for i, page in enumerate(pdf_reader.pages):
                extracted_page_text = page.extract_text()
                if extracted_page_text:
                    text += extracted_page_text
                else:
                    print(f"Warning: No text extracted from PDF page {i+1}.")
        else:
            print(f"--- File type not supported: {filename} ---")
            return None
        
        print(f"--- Extracted text length: {len(text)} characters ---")
        if not text.strip():
            print("--- Warning: Extracted text is empty or only whitespace. ---")
        
        return text
    except Exception as e:
        print(f"!!! An error occurred during file extraction: {e} !!!")
        return None

# Load personas and create the workflow when the app starts
personas = load_personas()
review_app = create_workflow(personas)

@app.route('/')
def index():
    """Renders the main page with the form."""
    return render_template('index.html', personas=load_personas())

def format_feedback(text):
    """Applies custom formatting and converts markdown to HTML."""
    # Bold lines starting with --- and the word "Feedback:"
    text = re.sub(r'^(---.*---)

    # --- Robust Input Processing ---
    if uploaded_file and uploaded_file.filename:
        extracted_text = extract_text_from_file(uploaded_file)
        if extracted_text:
            document_text = extracted_text
        else:
            return f"Error: Could not extract text from the uploaded file '{uploaded_file.filename}'. The file might be empty, corrupted, or an unsupported format.", 400
    
    if not document_text and request.form.get('document'):
        document_text = request.form.get('document')

    # --- Final Validation ---
    if not document_text:
        return "Please provide a document to review, either by uploading a file or pasting content.", 400
    
    if not selected_reviewers:
        return "Please select at least one reviewer.", 400

    inputs = {
        "document": document_text,
        "selected_reviewers": selected_reviewers,
        "reviews": {}
    }

    supervisor_feedback, reviews, final_feedback = "", {}, ""
    for event in review_app.stream(inputs):
        if "supervisor" in event:
            feedback = event["supervisor"].get("supervisor_feedback", "")
            supervisor_feedback = format_feedback(feedback)
        for key in selected_reviewers:
            if key in event:
                raw_reviews = event[key].get("reviews", {})
                processed_reviews = {name: format_feedback(text) for name, text in raw_reviews.items()}
                reviews.update(processed_reviews)
        if "aggregator" in event:
            feedback = event["aggregator"].get("final_feedback", "")
            final_feedback = format_feedback(feedback)

    return render_template(
        'results.html',
        supervisor_feedback=supervisor_feedback,
        reviews=reviews,
        final_feedback=final_feedback
    )

@app.route('/personas')
def manage_personas():
    """Renders the page to manage personas."""
    return render_template('manage_personas.html', personas=load_personas())

@app.route('/personas', methods=['POST'])
def update_personas():
    """Handles updating the personas file."""
    new_personas = {}
    for key in request.form:
        if key.startswith('name_'):
            persona_id = key.split('name_')[1]
            name = request.form[key]
            prompt = request.form.get(f'prompt_{persona_id}', '')
            if name and prompt:
                new_personas[persona_id] = {'name': name, 'prompt': prompt}

    new_id = request.form.get('new_id')
    new_name = request.form.get('new_name')
    new_prompt = request.form.get('new_prompt')
    if new_id and new_name and new_prompt:
        new_personas[new_id.lower().replace(' ', '_')] = {'name': new_name, 'prompt': new_prompt}

    save_personas(new_personas)
    
    # We need to recreate the workflow with the new personas
    global review_app
    review_app = create_workflow(new_personas)
    
    return redirect(url_for('manage_personas'))

if __name__ == '__main__':
    app.run(debug=True)

, r'**\1**', text, flags=re.MULTILINE)
    text = re.sub(r'^(Feedback:)', r'**\1**', text, flags=re.IGNORECASE | re.MULTILINE)
    return markdown.markdown(text)

@app.route('/review', methods=['POST'])
def review():
    """Handles the form submission and displays the review results."""
    document_text = ""
    uploaded_file = request.files.get('document_file')
    selected_reviewers = request.form.getlist('reviewers')

    # --- Robust Input Processing ---
    if uploaded_file and uploaded_file.filename:
        extracted_text = extract_text_from_file(uploaded_file)
        if extracted_text:
            document_text = extracted_text
        else:
            return f"Error: Could not extract text from the uploaded file '{uploaded_file.filename}'. The file might be empty, corrupted, or an unsupported format.", 400
    
    if not document_text and request.form.get('document'):
        document_text = request.form.get('document')

    # --- Final Validation ---
    if not document_text:
        return "Please provide a document to review, either by uploading a file or pasting content.", 400
    
    if not selected_reviewers:
        return "Please select at least one reviewer.", 400

    inputs = {
        "document": document_text,
        "selected_reviewers": selected_reviewers,
        "reviews": {}
    }

    supervisor_feedback, reviews, final_feedback = "", {}, ""
    for event in review_app.stream(inputs):
        if "supervisor" in event:
            feedback = event["supervisor"].get("supervisor_feedback", "")
            supervisor_feedback = format_feedback(feedback)
        for key in selected_reviewers:
            if key in event:
                raw_reviews = event[key].get("reviews", {})
                processed_reviews = {name: format_feedback(text) for name, text in raw_reviews.items()}
                reviews.update(processed_reviews)
        if "aggregator" in event:
            feedback = event["aggregator"].get("final_feedback", "")
            final_feedback = format_feedback(feedback)

    return render_template(
        'results.html',
        supervisor_feedback=supervisor_feedback,
        reviews=reviews,
        final_feedback=final_feedback
    )

@app.route('/personas')
def manage_personas():
    """Renders the page to manage personas."""
    return render_template('manage_personas.html', personas=load_personas())

@app.route('/personas', methods=['POST'])
def update_personas():
    """Handles updating the personas file."""
    new_personas = {}
    for key in request.form:
        if key.startswith('name_'):
            persona_id = key.split('name_')[1]
            name = request.form[key]
            prompt = request.form.get(f'prompt_{persona_id}', '')
            if name and prompt:
                new_personas[persona_id] = {'name': name, 'prompt': prompt}

    new_id = request.form.get('new_id')
    new_name = request.form.get('new_name')
    new_prompt = request.form.get('new_prompt')
    if new_id and new_name and new_prompt:
        new_personas[new_id.lower().replace(' ', '_')] = {'name': new_name, 'prompt': new_prompt}

    save_personas(new_personas)
    
    # We need to recreate the workflow with the new personas
    global review_app
    review_app = create_workflow(new_personas)
    
    return redirect(url_for('manage_personas'))

if __name__ == '__main__':
    app.run(debug=True)

, r'**\1**', text, flags=re.MULTILINE)
    text = re.sub(r'^(Feedback:)', r'**\1**', text, flags=re.IGNORECASE | re.MULTILINE)
    return markdown.markdown(text)

    # --- Robust Input Processing ---
    if uploaded_file and uploaded_file.filename:
        extracted_text = extract_text_from_file(uploaded_file)
        if extracted_text:
            document_text = extracted_text
        else:
            return f"Error: Could not extract text from the uploaded file '{uploaded_file.filename}'. The file might be empty, corrupted, or an unsupported format.", 400
    
    if not document_text and request.form.get('document'):
        document_text = request.form.get('document')

    # --- Final Validation ---
    if not document_text:
        return "Please provide a document to review, either by uploading a file or pasting content.", 400
    
    if not selected_reviewers:
        return "Please select at least one reviewer.", 400

    inputs = {
        "document": document_text,
        "selected_reviewers": selected_reviewers,
        "reviews": {}
    }

    supervisor_feedback, reviews, final_feedback = "", {}, ""
    for event in review_app.stream(inputs):
        if "supervisor" in event:
            feedback = event["supervisor"].get("supervisor_feedback", "")
            supervisor_feedback = format_feedback(feedback)
        for key in selected_reviewers:
            if key in event:
                raw_reviews = event[key].get("reviews", {})
                processed_reviews = {name: format_feedback(text) for name, text in raw_reviews.items()}
                reviews.update(processed_reviews)
        if "aggregator" in event:
            feedback = event["aggregator"].get("final_feedback", "")
            final_feedback = format_feedback(feedback)

    return render_template(
        'results.html',
        supervisor_feedback=supervisor_feedback,
        reviews=reviews,
        final_feedback=final_feedback
    )

@app.route('/personas')
def manage_personas():
    """Renders the page to manage personas."""
    return render_template('manage_personas.html', personas=load_personas())

@app.route('/personas', methods=['POST'])
def update_personas():
    """Handles updating the personas file."""
    new_personas = {}
    for key in request.form:
        if key.startswith('name_'):
            persona_id = key.split('name_')[1]
            name = request.form[key]
            prompt = request.form.get(f'prompt_{persona_id}', '')
            if name and prompt:
                new_personas[persona_id] = {'name': name, 'prompt': prompt}

    new_id = request.form.get('new_id')
    new_name = request.form.get('new_name')
    new_prompt = request.form.get('new_prompt')
    if new_id and new_name and new_prompt:
        new_personas[new_id.lower().replace(' ', '_')] = {'name': new_name, 'prompt': new_prompt}

    save_personas(new_personas)
    
    # We need to recreate the workflow with the new personas
    global review_app
    review_app = create_workflow(new_personas)
    
    return redirect(url_for('manage_personas'))

if __name__ == '__main__':
    app.run(debug=True)

, r'**\1**', text, flags=re.MULTILINE)
    text = re.sub(r'^(Feedback:)', r'**\1**', text, flags=re.IGNORECASE | re.MULTILINE)
    return markdown.markdown(text)

@app.route('/review', methods=['POST'])
def review():
    """Handles the form submission and displays the review results."""
    document_text = ""
    uploaded_file = request.files.get('document_file')
    selected_reviewers = request.form.getlist('reviewers')

    # --- Robust Input Processing ---
    if uploaded_file and uploaded_file.filename:
        extracted_text = extract_text_from_file(uploaded_file)
        if extracted_text:
            document_text = extracted_text
        else:
            return f"Error: Could not extract text from the uploaded file '{uploaded_file.filename}'. The file might be empty, corrupted, or an unsupported format.", 400
    
    if not document_text and request.form.get('document'):
        document_text = request.form.get('document')

    # --- Final Validation ---
    if not document_text:
        return "Please provide a document to review, either by uploading a file or pasting content.", 400
    
    if not selected_reviewers:
        return "Please select at least one reviewer.", 400

    inputs = {
        "document": document_text,
        "selected_reviewers": selected_reviewers,
        "reviews": {}
    }

    supervisor_feedback, reviews, final_feedback = "", {}, ""
    for event in review_app.stream(inputs):
        if "supervisor" in event:
            feedback = event["supervisor"].get("supervisor_feedback", "")
            supervisor_feedback = format_feedback(feedback)
        for key in selected_reviewers:
            if key in event:
                raw_reviews = event[key].get("reviews", {})
                processed_reviews = {name: format_feedback(text) for name, text in raw_reviews.items()}
                reviews.update(processed_reviews)
        if "aggregator" in event:
            feedback = event["aggregator"].get("final_feedback", "")
            final_feedback = format_feedback(feedback)

    return render_template(
        'results.html',
        supervisor_feedback=supervisor_feedback,
        reviews=reviews,
        final_feedback=final_feedback
    )

@app.route('/personas')
def manage_personas():
    """Renders the page to manage personas."""
    return render_template('manage_personas.html', personas=load_personas())

@app.route('/personas', methods=['POST'])
def update_personas():
    """Handles updating the personas file."""
    new_personas = {}
    for key in request.form:
        if key.startswith('name_'):
            persona_id = key.split('name_')[1]
            name = request.form[key]
            prompt = request.form.get(f'prompt_{persona_id}', '')
            if name and prompt:
                new_personas[persona_id] = {'name': name, 'prompt': prompt}

    new_id = request.form.get('new_id')
    new_name = request.form.get('new_name')
    new_prompt = request.form.get('new_prompt')
    if new_id and new_name and new_prompt:
        new_personas[new_id.lower().replace(' ', '_')] = {'name': new_name, 'prompt': new_prompt}

    save_personas(new_personas)
    
    # We need to recreate the workflow with the new personas
    global review_app
    review_app = create_workflow(new_personas)
    
    return redirect(url_for('manage_personas'))

if __name__ == '__main__':
    app.run(debug=True)

