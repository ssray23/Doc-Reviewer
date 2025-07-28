import os
from langgraph.graph import StateGraph, END
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage
from typing import TypedDict, Annotated, List, Dict

# Load API key from environment variables
from dotenv import load_dotenv
load_dotenv()

def merge_reviews(left: dict, right: dict) -> dict:
    """Merges two dictionaries of reviews."""
    return {**left, **right}

class ReviewState(TypedDict):
    """Represents the state of our graph."""
    document: str
    selected_reviewers: List[str]
    supervisor_feedback: str
    # Use a dictionary to store feedback from multiple reviewers, with a custom merger
    reviews: Annotated[Dict[str, str], merge_reviews]
    final_feedback: str

# Will use a placeholder if API key is not found
api_key = os.getenv("OPENAI_API_KEY", "YOUR_OPENAI_API_KEY")
model = ChatOpenAI(api_key=api_key, temperature=0)

def supervisor_node(state):
    """The supervisor node remains the same."""
    response = model.invoke([
        HumanMessage(
            f"You are the supervisor. Please review the following document and provide your feedback.\n\nDocument:\n{state['document']}"
        )
    ])
    return {"supervisor_feedback": response.content}

def create_reviewer_node(persona_key: str, persona_config: dict):
    """Function factory to create a reviewer node for a specific persona."""
    def reviewer_node(state):
        response = model.invoke([
            HumanMessage(
                f"{persona_config['prompt']}\n\nPlease review the following document and provide your feedback.\n\nDocument:\n{state['document']}"
            )
        ])
        # Return feedback in a dictionary with the persona key
        return {"reviews": {persona_config['name']: response.content}}
    return reviewer_node

def aggregator_node(state):
    """Aggregates all the feedback."""
    supervisor_feedback = state.get('supervisor_feedback', '')
    reviews = state.get('reviews', {})

    # Format the collected reviews
    review_texts = [f"--- {name}'s Feedback ---\n{feedback}" for name, feedback in reviews.items()]
    combined_reviews = "\n\n".join(review_texts)

    prompt = (
        f"You are the aggregator. Please compile the final feedback, taking into account the supervisor's initial feedback and all subsequent reviews.\n\n"
        f"--- Supervisor's Feedback ---\n{supervisor_feedback}\n\n"
        f"--- Individual Reviews ---\n{combined_reviews}"
    )

    response = model.invoke([HumanMessage(prompt)])
    return {"final_feedback": response.content}

def create_workflow(personas: dict):
    """Creates the dynamic LangGraph workflow."""
    workflow = StateGraph(ReviewState)

    # Add the static nodes
    workflow.add_node("supervisor", supervisor_node)
    workflow.add_node("aggregator", aggregator_node)

    # Add a node for each persona available
    for key, config in personas.items():
        workflow.add_node(key, create_reviewer_node(key, config))

    # The supervisor runs first
    workflow.set_entry_point("supervisor")

    # After the supervisor, run the selected reviewers in parallel
    workflow.add_conditional_edges(
        "supervisor",
        lambda state: state["selected_reviewers"],
        {key: key for key in personas} # Route to the node with the same name as the persona key
    )

    # After each reviewer runs, they should proceed to the aggregator
    for key in personas:
        workflow.add_edge(key, "aggregator")

    # The aggregator is the final step
    workflow.add_edge("aggregator", END)

    return workflow.compile()

if __name__ == "__main__":
    # Example of how to run the new dynamic workflow
    # This part needs to load personas from the file to run
    from personas import personas as test_personas
    app = create_workflow(test_personas)
    inputs = {
        "document": "This is a test document about the future of AI.",
        "selected_reviewers": ["strict", "travel_expert"], # Select which reviewers to run
        "reviews": {} # Initialize reviews as an empty dict
    }
    for event in app.stream(inputs):
        for key, value in event.items():
            print(f"--- {key} ---")
            print(value)
            print("\n")
